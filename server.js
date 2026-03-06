require("dotenv").config();
const express = require("express");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const Anthropic = require("@anthropic-ai/sdk").default;
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require("docx");

const app = express();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.static("public"));

// ─── Rota: Gerar currículo a partir do formulário ───────────────────────────
app.post("/gerar-curriculo", async (req, res) => {
  const { nome, telefone, email, cidade, whatsapp, linkedin, objetivo, escolaridade, experiencias, habilidades, cursos, template } = req.body;

  const contatoExtra = [
    whatsapp ? `- WhatsApp: ${whatsapp}` : "",
    linkedin ? `- LinkedIn: ${linkedin}` : "",
  ].filter(Boolean).join("\n");

  let prompt;

  if (template === "antigo") {
    prompt = `Você é um especialista em redação de currículos profissionais brasileiros no estilo tradicional dos anos 2000.
Crie um currículo no formato EXATO abaixo, usando os dados fornecidos.

DADOS DO CLIENTE:
- Nome: ${nome}
- Telefone: ${telefone || "Não informado"}
- E-mail: ${email || "Não informado"}
- Cidade: ${cidade || "Não informada"}
${contatoExtra}
- Objetivo profissional: ${objetivo}
- Escolaridade: ${escolaridade}
- Experiências profissionais: ${experiencias}
- Habilidades: ${habilidades || "Não informadas"}
- Cursos e certificados: ${cursos || "Não informados"}

REGRAS DE FORMATAÇÃO — SIGA RIGOROSAMENTE:
- Primeira linha: apenas o NOME EM MAIÚSCULAS
- Títulos de seção em MAIÚSCULO sozinhos na linha, sem símbolo algum
- Seções obrigatórias na ordem: DADOS PESSOAIS, OBJETIVO, ESCOLARIDADE, EXPERIÊNCIA PROFISSIONAL, QUALIFICAÇÕES${cursos ? ", CURSOS E CERTIFICADOS" : ""}, CARTA DE APRESENTAÇÃO
- DADOS PESSOAIS: informações em linhas simples (sem hífen)
- OBJETIVO: uma linha com "- " no início
- ESCOLARIDADE: uma linha com "- " no início
- EXPERIÊNCIA PROFISSIONAL:
  * Nome de cada empresa em MAIÚSCULAS sozinho na linha
  * Na linha SEGUINTE: cargo e período separados por espaços: "Cargo  MM/AAAA - MM/AAAA"
  * Se não souber o período exato, estime ou omita
- QUALIFICAÇÕES: lista de itens com "- " no início
- CARTA DE APRESENTAÇÃO: parágrafo de apresentação com "- " no início
- PROIBIDO: markdown, **, ##, ___, ou qualquer símbolo especial
- Separe seções com UMA linha em branco
- OBRIGATÓRIO: português brasileiro com TODOS os acentos`;
  } else {
    prompt = `Você é um especialista em redação de currículos profissionais brasileiros. Crie um currículo completo e bem redigido com os dados abaixo.

DADOS DO CLIENTE:
- Nome: ${nome}
- Telefone: ${telefone || "Não informado"}
- E-mail: ${email || "Não informado"}
- Cidade: ${cidade || "Não informada"}
${contatoExtra}
- Objetivo profissional: ${objetivo}
- Escolaridade: ${escolaridade}
- Experiências profissionais: ${experiencias}
- Habilidades: ${habilidades || "Não informadas"}
- Cursos e certificados: ${cursos || "Não informados"}

REGRAS DE FORMATAÇÃO (SIGA EXATAMENTE):
- PROIBIDO usar markdown: sem ##, **, *, ___, ---, ou qualquer símbolo especial
- Títulos de seção em MAIÚSCULO sozinhos na linha (ex: DADOS PESSOAIS)
- Itens com hífen simples (ex: - Telefone: (31) 99999-0000)
- Separe seções com uma linha em branco
- Retorne APENAS o texto do currículo, sem comentários
- Seções: DADOS PESSOAIS, OBJETIVO, FORMAÇÃO ACADÊMICA, EXPERIÊNCIA PROFISSIONAL, HABILIDADES${cursos ? ", CURSOS E CERTIFICADOS" : ""}
- Nas experiências, descreva as funções de forma profissional
- Se a escolaridade for baixa, valorize as experiências práticas
- OBRIGATÓRIO: use português brasileiro correto com TODOS os acentos (ção, ões, ção, ã, é, ê, á, â, ó, ú, ç, etc.)
- NUNCA escreva palavras sem acento: manutenção (não manutencao), realização (não realizacao), serviços (não servicos), endereço (não endereco), período (não periodo), etc.`;
  }

  await gerarComStream(prompt, res);
});

// ─── Rota: Atualizar currículo a partir de PDF ───────────────────────────────
app.post("/atualizar-pdf", upload.single("pdf"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ erro: "Nenhum PDF enviado." });
  }

  const novaInfo = req.body.novaInfo || "";
  const template = req.body.template || "classico";
  const pdfBase64 = req.file.buffer.toString("base64");

  let instrucoes;

  if (template === "antigo") {
    instrucoes = `Você é um especialista em currículos profissionais brasileiros no estilo tradicional.

Leia o PDF acima e reescreva o currículo MANTENDO FIELMENTE o mesmo estilo e formato do documento original.
${novaInfo ? `\nADICIONE TAMBÉM as seguintes informações novas:\n${novaInfo}` : ""}

REGRAS DE FORMATAÇÃO — SIGA RIGOROSAMENTE:
- Primeira linha: apenas o NOME EM MAIÚSCULAS
- Títulos de seção em MAIÚSCULO sozinhos na linha
- Seções na ordem do original: DADOS PESSOAIS, OBJETIVO, ESCOLARIDADE, EXPERIÊNCIA PROFISSIONAL, QUALIFICAÇÕES, CARTA DE APRESENTAÇÃO (e outras que existirem)
- DADOS PESSOAIS: informações em linhas simples
- OBJETIVO, ESCOLARIDADE: uma linha com "- " no início
- EXPERIÊNCIA PROFISSIONAL:
  * Nome de cada empresa em MAIÚSCULAS sozinho na linha
  * Linha seguinte: cargo e período: "Cargo  MM/AAAA - MM/AAAA"
- QUALIFICAÇÕES e CARTA DE APRESENTAÇÃO: itens com "- " no início
- PROIBIDO: markdown, **, ##, ___ ou qualquer símbolo especial
- Separe seções com UMA linha em branco
- Mantenha TODOS os dados originais sem omitir nada
- OBRIGATÓRIO: português brasileiro com TODOS os acentos`;
  } else {
    instrucoes = `Você é um especialista em redação de currículos profissionais brasileiros.

Leia o PDF acima (currículo antigo) e reescreva-o de forma mais profissional, organizada e moderna.
${novaInfo ? `\nADICIONE TAMBÉM as seguintes informações novas informadas pelo cliente:\n${novaInfo}` : ""}

REGRAS DE FORMATAÇÃO (SIGA EXATAMENTE):
- PROIBIDO usar markdown: sem ##, **, *, ___, ---, ou qualquer símbolo especial
- Títulos de seção em MAIÚSCULO sozinhos na linha (ex: DADOS PESSOAIS)
- Itens com hífen simples (ex: - Telefone: (31) 99999-0000)
- Separe seções com uma linha em branco
- Retorne APENAS o texto do currículo, sem comentários
- Seções: DADOS PESSOAIS, OBJETIVO, FORMAÇÃO ACADÊMICA, EXPERIÊNCIA PROFISSIONAL, HABILIDADES, CURSOS (se houver)
- Mantenha todos os dados originais
- Melhore as descrições das experiências para soarem mais profissionais
- OBRIGATÓRIO: use português brasileiro correto com TODOS os acentos`;
  }

  try {
    const stream = client.messages.stream({
      model: "claude-opus-4-6",
      max_tokens: 2048,
      messages: [{
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: pdfBase64 }
          },
          { type: "text", text: instrucoes }
        ]
      }]
    });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        res.write(event.delta.text);
      }
    }
    res.end();
  } catch (error) {
    console.error("Erro na API:", error.message);
    if (!res.headersSent) {
      res.status(500).json({ erro: "Erro ao processar PDF: " + error.message });
    }
  }
});

// ─── Rota: Salvar como Word (.docx) ──────────────────────────────────────────
app.post("/salvar-word", async (req, res) => {
  const { texto, nome } = req.body;
  if (!texto) return res.status(400).json({ erro: "Texto vazio." });

  const linhas = texto.split("\n");
  const ehMaiusculo = (t) => t && t === t.toUpperCase() && t.length > 2 && !/^\d/.test(t);

  // Primeira linha em maiúsculo = nome do candidato
  const primeiraLinhaMaiuscula = linhas.find(l => ehMaiusculo(l.trim()));
  const nomeDoc = primeiraLinhaMaiuscula?.trim() || nome || "";
  let primeiraCapPulada = false;

  const paragrafos = linhas.map((linha) => {
    const trimmed = linha.trim();

    // Pula a PRIMEIRA linha em maiúsculo (nome já está no cabeçalho)
    if (!primeiraCapPulada && ehMaiusculo(trimmed)) {
      primeiraCapPulada = true;
      return null;
    }

    // Linha em MAIÚSCULO = título de seção
    if (ehMaiusculo(trimmed)) {
      return new Paragraph({
        text: trimmed,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 80 },
        border: { bottom: { color: "00b4d8", size: 6, style: "single" } },
      });
    }

    // Linha vazia
    if (!trimmed) {
      return new Paragraph({ text: "", spacing: { after: 60 } });
    }

    // Linha normal
    return new Paragraph({
      children: [new TextRun({ text: trimmed, size: 22 })],
      spacing: { after: 60 },
    });
  }).filter(Boolean);

  const docParagrafos = [
    new Paragraph({
      children: [new TextRun({ text: nomeDoc, bold: true, size: 32 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
    ...paragrafos,
  ];

  const doc = new Document({
    sections: [{ properties: {}, children: docParagrafos }],
  });

  const buffer = await Packer.toBuffer(doc);
  const nomeArquivo = `Curriculo_${nomeDoc.replace(/\s+/g, "_")}.docx`;

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="${nomeArquivo}"`);
  res.send(buffer);
});

// ─── Função auxiliar: envia resposta em streaming ────────────────────────────
async function gerarComStream(prompt, res) {
  try {
    const stream = client.messages.stream({
      model: "claude-opus-4-6",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        res.write(event.delta.text);
      }
    }

    res.end();
  } catch (error) {
    console.error("Erro na API:", error.message);
    if (!res.headersSent) {
      res.status(500).json({ erro: "Erro ao gerar currículo. Verifique sua chave de API." });
    }
  }
}

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`✅ Servidor rodando em http://localhost:${PORT}`);
  console.log(`   Abra o navegador e acesse: http://localhost:${PORT}`);
});
