const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
app.use(express.json());

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Base de datos de propiedades
const propiedades = {
  "9755676": {
    ref: "9755676",
    titulo: "Apartamento Sabaneta Excelente ubicacion",
    tipo: "Apartamento",
    negocio: "Venta",
    precio: "$460.000.000 COP",
    ciudad: "Sabaneta, Antioquia",
    zona: "El Carmelo",
    area: "65 m2",
    habitaciones: 2,
    banos: 2,
    garaje: 1,
    estrato: 4,
    administracion: "$290.000 COP/mes",
    descripcion: "Apartamento muy iluminado con vista a zona verde, cerca del parque principal. 2 habitaciones, 2 banos completos, sala-comedor, balcon, cocina y zona de ropas. Cuenta con porteria 24 horas, gimnasio, piscina, zona humeda y parque infantil. Facil acceso a transporte publico y centros comerciales.",
    caracteristicas: "Admite mascotas, balcon, cocina integral, calentador, closets, ascensor, gimnasio, piscina",
    link: "https://info.wasi.co/apartamento-venta-el-carmelo-sabaneta/9755676"
  }
};

// Verificacion webhook Meta
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

// Recibir mensajes
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  const value = req.body?.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0];

  if (!message || message.type !== "text") return;
  if (value?.statuses) return;

  const userText = message.text.body;
  const userPhone = message.from;

  // Buscar referencia de propiedad en el mensaje
  let fichaPropiedad = "";
  for (const ref in propiedades) {
    if (userText.includes(ref)) {
      const p = propiedades[ref];
      fichaPropiedad = `FICHA DE PROPIEDAD: Ref ${p.ref} | ${p.titulo} | Tipo: ${p.tipo} | Negocio: ${p.negocio} | Precio: ${p.precio} | Ubicacion: ${p.zona}, ${p.ciudad} | Area: ${p.area} | Habitaciones: ${p.habitaciones} | Banos: ${p.banos} | Garaje: ${p.garaje} | Estrato: ${p.estrato} | Administracion: ${p.administracion} | Caracteristicas: ${p.caracteristicas} | Descripcion: ${p.descripcion} | Link: ${p.link}`;
      break;
    }
  }

  const systemPrompt = fichaPropiedad
    ? `Eres un asesor inmobiliario profesional en Colombia. El usuario pregunta por una propiedad especifica. Usa esta informacion para responder: ${fichaPropiedad}. Responde en texto plano sin emojis ni saltos de linea. Maximo 3 oraciones presentando la propiedad de forma atractiva.`
    : `Eres un asesor inmobiliario profesional en Colombia. Responde en texto plano sin emojis ni saltos de linea. Maximo 2 oraciones. Si el usuario pregunta por una propiedad, pidele la referencia del anuncio.`;

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