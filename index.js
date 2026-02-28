const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { google } = require("googleapis");

const app = express();
app.use(bodyParser.json());

const TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;
const SPREADSHEET_ID = process.env.SHEET_ID;

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

app.post("/", async (req, res) => {
  try {
    const message = req.body.message;

    if (!message || !message.text) {
      return res.sendStatus(200);
    }

    const chatId = message.chat.id;
    const text = message.text.trim();

    // Regex para pegar valor + descrição
    const regex = /^(\d+[.,]?\d*)\s+(.+)/;
    const match = text.match(regex);

    if (!match) {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: "Envie no formato:\n150 gasolina"
      });
      return res.sendStatus(200);
    }

    const valor = match[1].replace(",", ".");
    const descricao = match[2];

    const client = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: client });

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "LANCAMENTOS!A:J",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [
            new Date(),      // A - Data
            "DESPESA",       // B - Tipo Registro
            descricao,       // C - Descrição
            "",              // D - Categoria (planilha calcula)
            valor,           // E - Valor
            "",              // F - Forma Pagamento
            "",              // G - Instituição
            "",              // H - Observação
            "",              // I - Mês (fórmula)
            ""               // J - Ano (fórmula)
          ]
        ]
      }
    });

    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: `✅ Gasto registrado:\nR$ ${valor} - ${descricao}`
    });

    res.sendStatus(200);

  } catch (error) {
    console.error(error);

    if (req.body?.message?.chat?.id) {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: req.body.message.chat.id,
        text: "❌ Erro ao registrar lançamento."
      });
    }

    res.sendStatus(200);
  }
});

app.get("/", (req, res) => {
  res.send("Bot financeiro ativo 🚀");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
