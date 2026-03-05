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
  const { nome, telefone, email, cidade, whatsapp, linkedin, objetivo, escolaridade, experiencias, habilidades, cursos } = req.body;

  const contatoExtra = [
    whatsapp ? `- WhatsApp: ${whatsapp}` : "",
    linkedin ? `- LinkedIn: ${linkedin}` : "",
  ].filter(Boolean).join("\n");

  const prompt = `Você é um especialista em redação de currículos profissionais brasileiros. Crie um currículo completo e bem redigido com os dados abaixo.

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
- Se a escolaridade for baixa, valorize as experiências práticas`;

  await gerarComStream(prompt, res);
});

// ─── Rota: Atualizar currículo a partir de PDF ───────────────────────────────
app.post("/atualizar-pdf", upload.single("pdf"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ erro: "Nenhum PDF enviado." });
  }

  let textoPdf;
  try {
    const dados = await pdfParse(req.file.buffer);
    textoPdf = dados.text;
  } catch {
    return res.status(400).json({ erro: "Não foi possível ler o PDF. Tente outro arquivo." });
  }

  const novaInfo = req.body.novaInfo || "";

  const prompt = `Você é um especialista em redação de currículos profissionais brasileiros.

Abaixo está o texto extraído de um currículo antigo em PDF. Reescreva-o de forma mais profissional, organizada e moderna.
${novaInfo ? `\nADICIONE TAMBÉM as seguintes informações novas informadas pelo cliente:\n${novaInfo}` : ""}

CURRÍCULO ANTIGO:
${textoPdf}

REGRAS DE FORMATAÇÃO (SIGA EXATAMENTE):
- PROIBIDO usar markdown: sem ##, **, *, ___, ---, ou qualquer símbolo especial
- Títulos de seção em MAIÚSCULO sozinhos na linha (ex: DADOS PESSOAIS)
- Itens com hífen simples (ex: - Telefone: (31) 99999-0000)
- Separe seções com uma linha em branco
- Retorne APENAS o texto do currículo, sem comentários
- Seções: DADOS PESSOAIS, OBJETIVO, FORMAÇÃO ACADÊMICA, EXPERIÊNCIA PROFISSIONAL, HABILIDADES, CURSOS (se houver)
- Mantenha todos os dados originais
- Melhore as descrições das experiências para soarem mais profissionais`;

  await gerarComStream(prompt, res);
});

// ─── Rota: Salvar como Word (.docx) ──────────────────────────────────────────
app.post("/salvar-word", async (req, res) => {
  const { texto, nome } = req.body;
  if (!texto) return res.status(400).json({ erro: "Texto vazio." });

  const linhas = texto.split("\n");
  const paragrafos = linhas.map((linha) => {
    const trimmed = linha.trim();

    // Linha em MAIÚSCULO = título de seção
    if (trimmed && trimmed === trimmed.toUpperCase() && trimmed.length > 2 && !/^\d/.test(trimmed)) {
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
  });

  // Cabeçalho com nome
  const nomeDoc = nome || "Currículo";
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
