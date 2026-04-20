const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const conversaciones = {};

async function getPropiedades() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: "A1:R100",
  });

  const rows = response.data.values;
  if (!rows || rows.length < 2) return {};

  const headers = rows[0];
  const propiedades = {};

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const prop = {};
    headers.forEach((header, index) => {
      prop[header] = row[index] || "";
    });
    if (prop.ref) {
      propiedades[prop.ref] = prop;
    }
  }

  return propiedades;
}

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  const value = req.body?.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0];

  if (!message || message.type !== "text") return;
  if (value?.statuses) return;

  const userText = message.text.body;
  const userPhone = message.from;

  const propiedades = await getPropiedades();

  const catalogo = Object.values(propiedades)
    .filter(p => p.disponible === "SI")
    .map(p => `Ref ${p.ref}: ${p.titulo} | ${p.tipo} | ${p.precio} | ${p.area} | ${p.habitaciones} hab | ${p.banos} ban | Garaje: ${p.garaje} | Estrato ${p.estrato} | Admon: ${p.administracion} | ${p.zona}, ${p.ciudad}`)
    .join("\n");

  let propiedadEncontrada = null;
  for (const ref in propiedades) {
    if (userText.includes(ref)) {
      propiedadEncontrada = propiedades[ref];
      break;
    }
  }

  let systemPrompt;

  if (propiedadEncontrada) {
    if (propiedadEncontrada.disponible !== "SI") {
      const reply = `Lo sentimos, la propiedad ${propiedadEncontrada.ref} ya no esta disponible. Te puedo mostrar otras opciones similares. Cuentame que estas buscando.`;
      await fetch(`https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: userPhone,
          type: "text",
          text: { body: reply }
        }),
      });
      return;
    }

    const p = propiedadEncontrada;
    const ficha = `Ref ${p.ref} | ${p.titulo} | Precio: ${p.precio} | Ubicacion: ${p.zona}, ${p.ciudad} | Area: ${p.area} | Hab: ${p.habitaciones} | Banos: ${p.banos} | Garaje: ${p.garaje} | Estrato: ${p.estrato} | Admon: ${p.administracion} | ${p.descripcion} | Caracteristicas: ${p.caracteristicas} | Link fotos: ${p.link}`;

    systemPrompt = `Eres un asesor inmobiliario profesional en Colombia. Presenta esta propiedad usando EXACTAMENTE este formato sin emojis:

[Titulo atractivo]

Ubicacion: [zona y ciudad]
Precio: [precio]
Area: [area] | Hab: [num] | Banos: [num] | Garaje: [num]
Estrato: [num] | Admon: [valor]

[Descripcion atractiva en 2 oraciones]

Ver fotos: [link]

Para mas informacion contacta a nuestro asesor: 3218939542

Ficha: ${ficha}`;

  } else {
    systemPrompt = `Eres un asesor inmobiliario profesional en Colombia. Tienes disponible este catalogo de propiedades (solo disponibles):

${catalogo}

Cuando el usuario describa lo que busca (presupuesto, zona, tipo, habitaciones), recomienda la propiedad mas adecuada indicando su referencia. Si no hay propiedades que coincidan dilo claramente. Responde en texto plano sin emojis ni saltos de linea. Maximo 3 oraciones.`;
  }

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1000,
    system: systemPrompt,
    messages: [{ role: "user", content: userText }],
  });

  const reply = response.content[0].text;

  await fetch(`https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: userPhone,
      type: "text",
      text: { body: reply }
    }),
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot corriendo en puerto ${PORT}`));