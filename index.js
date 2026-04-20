const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
app.use(express.json());

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
    descripcion: "Apartamento muy iluminado con vista a zona verde, cerca del parque principal. Porteria 24 horas, gimnasio, piscina, zona humeda y parque infantil.",
    caracteristicas: "Admite mascotas, balcon, cocina integral, calentador, closets, ascensor, gimnasio, piscina",
    link: "https://info.wasi.co/apartamento-venta-el-carmelo-sabaneta/9755676"
  }
};

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

  const userText = message.text.body.trim().toLowerCase();
  const userPhone = message.from;

  // Transferir a agente humano con contexto completo
  if (conversaciones[userPhone]?.estado === "esperando_confirmacion" &&
      (userText === "si" || userText === "sí" || userText === "yes")) {

    const p = conversaciones[userPhone].propiedad;
    const mensajeAsesor = `Hola, vengo del bot inmobiliario y estoy interesado en una propiedad. Estos son mis datos:%0A%0APropiedad consultada: ${p.titulo}%0ARef: ${p.ref}%0APrecio: ${p.precio}%0AUbicacion: ${p.zona}, ${p.ciudad}%0AArea: ${p.area} | Hab: ${p.habitaciones} | Banos: ${p.banos}%0AEstrato: ${p.estrato} | Admon: ${p.administracion}%0A%0AMi numero: ${userPhone}%0A%0APor favor contactarme para mas informacion.`;

    const linkAsesor = `https://wa.me/573218939542?text=${mensajeAsesor}`;

    const transferMsg = `Perfecto. Haz clic en este link para hablar directamente con nuestro asesor. El ya tendra toda la informacion de tu consulta lista: ${linkAsesor}`;

    conversaciones[userPhone].estado = "transferido";

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
        text: { body: transferMsg }
      }),
    });
    return;
  }

  // Buscar referencia de propiedad
  let fichaPropiedad = "";
  let propiedadEncontrada = null;

  for (const ref in propiedades) {
    if (message.text.body.includes(ref)) {
      propiedadEncontrada = propiedades[ref];
      fichaPropiedad = `FICHA: Ref ${propiedadEncontrada.ref} | ${propiedadEncontrada.titulo} | ${propiedadEncontrada.tipo} en ${propiedadEncontrada.negocio} | Precio: ${propiedadEncontrada.precio} | Ubicacion: ${propiedadEncontrada.zona}, ${propiedadEncontrada.ciudad} | Area: ${propiedadEncontrada.area} | Habitaciones: ${propiedadEncontrada.habitaciones} | Banos: ${propiedadEncontrada.banos} | Garaje: ${propiedadEncontrada.garaje} | Estrato: ${propiedadEncontrada.estrato} | Administracion: ${propiedadEncontrada.administracion} | Caracteristicas: ${propiedadEncontrada.caracteristicas} | Descripcion: ${propiedadEncontrada.descripcion} | Link: ${propiedadEncontrada.link}`;
      break;
    }
  }

  let systemPrompt;

  if (fichaPropiedad) {
    conversaciones[userPhone] = {
      estado: "esperando_confirmacion",
      propiedad: propiedadEncontrada
    };

    systemPrompt = `Eres un asesor inmobiliario profesional en Colombia. Presenta esta propiedad usando EXACTAMENTE este formato en texto plano sin emojis:

"[Titulo atractivo de una linea]

Ubicacion: [zona y ciudad]
Precio: [precio]
Area: [area] | Hab: [num] | Banos: [num] | Garaje: [si/no]
Estrato: [num] | Admon: [valor mes]

[Descripcion atractiva en 2 oraciones]

Ver fotos: [link]

Te gustaria hablar con un asesor para mas informacion? Responde SI"

Usa esta informacion: ${fichaPropiedad}`;

  } else {
    systemPrompt = `Eres un asesor inmobiliario profesional en Colombia. Responde en texto plano sin emojis ni saltos de linea. Maximo 2 oraciones. Si preguntan por una propiedad pideles la referencia del anuncio.`;
  }

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1000,
    system: systemPrompt,
    messages: [{ role: "user", content: message.text.body }],
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