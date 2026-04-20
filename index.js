const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
app.use(express.json());

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const propiedades = {
  "9755676": {
    ref: "9755676", tipo: "Apartamento", negocio: "Venta",
    titulo: "Apartamento en El Carmelo, Sabaneta",
    precio: "$460.000.000 COP", ciudad: "Sabaneta, Antioquia", zona: "El Carmelo",
    area: "65 m2", habitaciones: 2, banos: 2, garaje: 1, estrato: 4,
    administracion: "$290.000 COP/mes",
    descripcion: "Apartamento muy iluminado con vista a zona verde, cerca del parque principal. Porteria 24 horas, gimnasio, piscina, zona humeda y parque infantil. Admite mascotas.",
    caracteristicas: "Balcon, cocina integral, calentador, closets, ascensor, gimnasio, piscina, admite mascotas",
    link: "https://info.wasi.co/apartamento-venta-el-carmelo-sabaneta/9755676"
  },
  "9910309": {
    ref: "9910309", tipo: "Casa", negocio: "Venta",
    titulo: "Casa en La Sebastiana, Envigado",
    precio: "$1.200.000.000 COP", ciudad: "Envigado, Antioquia", zona: "La Sebastiana",
    area: "204 m2", habitaciones: 4, banos: 3, garaje: 4, estrato: 5,
    administracion: "$890.000 COP/mes",
    descripcion: "Acogedora casa en unidad residencial tranquila y familiar, con terraza, cerca del Mall Terracina y City Plaza. Cancha, salon social y juegos infantiles. Arboles frutales y zonas verdes.",
    caracteristicas: "Terraza, patio, balcon, biblioteca/estudio, closets, vigilancia, club social, zonas verdes, admite mascotas",
    link: "https://info.wasi.co/casa-venta-la-sebastiana-envigado/9910309"
  },
  "9928022": {
    ref: "9928022", tipo: "Apartamento", negocio: "Venta",
    titulo: "Apartamento en Altos del Poblado, Medellin",
    precio: "$610.000.000 COP", ciudad: "Medellin, Antioquia", zona: "Altos del Poblado",
    area: "67 m2", habitaciones: 2, banos: 2, garaje: 2, estrato: 4,
    administracion: "$490.000 COP/mes",
    descripcion: "Apartamento piso 11 con hermosa vista verde y panoramica, muy iluminado con excelentes acabados. Incluye deposito en el mismo piso. Piscina, gimnasio, cancha de squash, sauna y turco.",
    caracteristicas: "Balcon, sauna, turco, deposito, calentador, closets, ascensor, piscina, gimnasio, cancha squash, admite mascotas",
    link: "https://info.wasi.co/apartamento-venta-altos-del-poblado-medellín/9928022"
  }
};

const catalogo = Object.values(propiedades).map(p =>
  `Ref ${p.ref}: ${p.titulo} | ${p.tipo} | ${p.precio} | ${p.area} | ${p.habitaciones} hab | ${p.banos} ban | Garaje: ${p.garaje} | Estrato ${p.estrato} | Admon: ${p.administracion} | ${p.zona}, ${p.ciudad}`
).join("\n");

const conversaciones = {};

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

  // Buscar propiedad especifica por ref
  let propiedadEncontrada = null;
  for (const ref in propiedades) {
    if (userText.includes(ref)) {
      propiedadEncontrada = propiedades[ref];
      break;
    }
  }

  let systemPrompt;

  if (propiedadEncontrada) {
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
    systemPrompt = `Eres un asesor inmobiliario profesional en Colombia. Tienes disponible este catalogo de propiedades:

${catalogo}

Cuando el usuario describa lo que busca (presupuesto, zona, tipo, habitaciones), recomienda la propiedad mas adecuada del catalogo indicando su referencia. Si pregunta por una referencia especifica que no existe, dile que no esta disponible. Responde en texto plano sin emojis ni saltos de linea. Maximo 3 oraciones.`;
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