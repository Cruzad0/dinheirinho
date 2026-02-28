require('dotenv').config();
const { Telegraf } = require('telegraf');
const { google } = require('googleapis');

const bot = new Telegraf(process.env.BOT_TOKEN);

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });
const SHEET_ID = process.env.SHEET_ID;

const estados = {};

// ================= FUNÇÕES =================

async function buscarLista(range) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range,
  });
  return (response.data.values || []).flat();
}

async function adicionarLinha(range, valores) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [valores] },
  });
}

async function buscarCategoria(descricao) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'PALAVRAS_CHAVE!A2:C',
  });

  const linhas = response.data.values || [];
  descricao = descricao.toLowerCase();

  for (let linha of linhas) {
    const palavra = linha[0]?.toLowerCase();
    if (descricao.includes(palavra)) {
      return { categoria: linha[1], tipo: linha[2], palavra };
    }
  }

  return null;
}

// ================= BOT =================

bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const texto = ctx.message.text.toLowerCase();

  try {

    // ======== CRIAR NOVA FORMA ========
    if (estados[userId]?.etapa === 'criar_forma') {
      if (texto === 'sim') {
        await adicionarLinha('FORMAS_PAGAMENTO!A:A', [estados[userId].novaForma]);
        estados[userId].formaPagamento = estados[userId].novaForma;
        estados[userId].etapa = 'instituicao';
        return ctx.reply('✅ Forma criada! Agora informe a instituição.');
      } else {
        estados[userId].etapa = 'forma';
        return ctx.reply('Informe uma forma válida.');
      }
    }

    // ======== CRIAR NOVA INSTITUIÇÃO ========
    if (estados[userId]?.etapa === 'criar_instituicao') {
      if (texto === 'sim') {
        await adicionarLinha('INSTITUICOES!A:A', [estados[userId].novaInstituicao]);
        estados[userId].instituicao = estados[userId].novaInstituicao;
        return finalizarLancamento(ctx, userId);
      } else {
        estados[userId].etapa = 'instituicao';
        return ctx.reply('Informe uma instituição válida.');
      }
    }

    // ======== ESCOLHER CATEGORIA EXISTENTE ========
    if (estados[userId]?.etapa === 'escolher_categoria') {
      const categorias = await buscarLista('CATEGORIAS!B2:B');

      if (!categorias.map(c => c.toLowerCase()).includes(texto)) {
        return ctx.reply(`Categoria inválida.\n${categorias.join('\n')}`);
      }

      await adicionarLinha('PALAVRAS_CHAVE!A:C', [
        estados[userId].descricao,
        texto,
        'DESPESA'
      ]);

      estados[userId].categoria = texto;
      estados[userId].tipo = 'DESPESA';
      estados[userId].etapa = 'forma';

      return ctx.reply('✅ Palavra associada! Agora informe a forma de pagamento.');
    }

    // ======== FORMA PAGAMENTO ========
    if (estados[userId]?.etapa === 'forma') {
      const formas = await buscarLista('FORMAS_PAGAMENTO!A2:A');

      if (!formas.map(f => f.toLowerCase()).includes(texto)) {
        estados[userId].novaForma = texto;
        estados[userId].etapa = 'criar_forma';
        return ctx.reply(`Forma não encontrada. Deseja criar "${texto}"? (sim/não)`);
      }

      estados[userId].formaPagamento = texto;
      estados[userId].etapa = 'instituicao';
      return ctx.reply('🏦 Informe a instituição.');
    }

    // ======== INSTITUIÇÃO ========
    if (estados[userId]?.etapa === 'instituicao') {
      const inst = await buscarLista('INSTITUICOES!A2:A');

      if (!inst.map(i => i.toLowerCase()).includes(texto)) {
        estados[userId].novaInstituicao = texto;
        estados[userId].etapa = 'criar_instituicao';
        return ctx.reply(`Instituição não encontrada. Deseja criar "${texto}"? (sim/não)`);
      }

      estados[userId].instituicao = texto;
      return finalizarLancamento(ctx, userId);
    }

    // ======== ENTRADA INICIAL ========
    const partes = texto.split(' ');
    const valor = parseFloat(partes[0].replace(',', '.'));
    const descricao = partes.slice(1).join(' ');

    if (isNaN(valor) || !descricao) {
      return ctx.reply('Formato: 45 gasolina');
    }

    const resultado = await buscarCategoria(descricao);

    if (!resultado) {
      const categorias = await buscarLista('CATEGORIAS!B2:B');
      estados[userId] = { valor, descricao, etapa: 'escolher_categoria' };
      return ctx.reply(
        `Palavra não encontrada.\nDeseja associar a qual categoria?\n${categorias.join('\n')}`
      );
    }

    estados[userId] = {
      valor,
      descricao,
      categoria: resultado.categoria,
      tipo: resultado.tipo,
      etapa: 'forma'
    };

    ctx.reply(
      `Categoria: ${resultado.categoria}\nTipo: ${resultado.tipo}\nInforme a forma de pagamento.`
    );

  } catch (error) {
    console.error(error);
    ctx.reply('Erro no processamento.');
  }
});

// ======== FINALIZAR ========
async function finalizarLancamento(ctx, userId) {
  const e = estados[userId];

  const agora = new Date();
  const data = agora.toLocaleDateString('pt-BR');
  const mes = agora.getMonth() + 1;
  const ano = agora.getFullYear();

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'LANCAMENTOS!A:J',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        data,
        e.tipo,
        e.descricao,
        e.categoria,
        e.valor,
        e.formaPagamento,
        e.instituicao,
        '',
        mes,
        ano
      ]],
    },
  });

  delete estados[userId];
  return ctx.reply('✅ Lançamento registrado com sucesso!');
}

bot.launch();
console.log('Bot rodando...');
