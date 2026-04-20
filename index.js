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
    headers.forEach((header, index) => { prop[header] = row[index] || ""; });
    if (prop.ref) propiedades[prop.ref] = prop;
  }
  return propiedades;
}

async function enviarMensaje(telefono, texto) {
  await fetch(`https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: telefono,
      type: "text",
      text: { body: texto }
    }),
  });
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
  if (value?.statuses) return;
  if (!message) return;
  if (message.type !== "text") return;
  if (!message.text?.body) return;

  const userText = message.text.body.trim();
  const userPhone = message.from;

  if (!conversaciones[userPhone]) {
    conversaciones[userPhone] = {
      estado: "inicio",
      nombre: null,
      linkUltima: null,
      historial: []
    };
  }

  const conv = conversaciones[userPhone];
  conv.historial.push({ role: "user", content: userText });

  const quiereAsesor = /\b(asesor|humano|persona|hablar con alguien|comunicar|contacto|agente)\b/i.test(userText);
  const confirma = /^(si|sí|yes|claro|dale|quiero|me interesa|perfecto|ok|okay)$/i.test(userText.toLowerCase());

 if (quiereAsesor || (confirma && conv.estado === "ofreciendo_asesor")) {
    const saludo = conv.nombre ? `Perfecto ${conv.nombre}` : `Perfecto`;
    const linkInfo = conv.linkUltima ? `&text=Hola,%20estoy%20interesado%20en%20esta%20propiedad:%20${encodeURIComponent(conv.linkUltima)}` : "";
    const linkAsesor = `https://wa.me/573028536489${linkInfo}`;
    
    // Mensaje al usuario con link pre-cargado
    const msgUsuario = `${saludo}! 😊 Haz clic aqui para hablar directamente con nuestro asesor, el ya tendra el contexto de tu consulta:\n${linkAsesor}`;
    await enviarMensaje(userPhone, msgUsuario);

    // Alerta automatica al asesor
    const nombreCliente = conv.nombre || "Cliente";
    const propInfo = conv.linkUltima ? `\nPropiedad de interes: ${conv.linkUltima}` : "\nConsulta general";
    const msgParaAsesor = `Nuevo lead Paraiso Inmobiliario!\nCliente: ${nombreCliente}\nNumero: +${userPhone}${propInfo}\nContactar a la brevedad.`;
    await enviarMensaje("573028536489", msgParaAsesor);

    conv.estado = "transferido";
    return;
  }

  const propiedades = await getPropiedades();
  const disponibles = Object.values(propiedades).filter(p => p.disponible === "SI");

  const catalogoDisponible = disponibles.map(p =>
    `Ref ${p.ref}: ${p.titulo} | ${p.tipo} | ${p.precio} | ${p.area} | ${p.habitaciones} hab | ${p.banos} ban | Garaje: ${p.garaje} | Estrato ${p.estrato} | Admon: ${p.administracion} | ${p.zona}, ${p.ciudad} | Link: ${p.link}`
  ).join("\n");

  const nombreMatch = userText.match(/(?:me llamo|soy|mi nombre es)\s+([A-Za-zÁáÉéÍíÓóÚú]+)/i);
  if (nombreMatch) conv.nombre = nombreMatch[1];

  let propiedadEncontrada = null;
  for (const ref in propiedades) {
    if (userText.includes(ref)) {
      propiedadEncontrada = propiedades[ref];
      break;
    }
  }

  let systemPrompt;

  if (propiedadEncontrada && propiedadEncontrada.disponible !== "SI") {
    conv.estado = "ofreciendo_asesor";
    conv.linkUltima = null;
    systemPrompt = `Eres un asesor inmobiliario profesional de Paraiso Inmobiliario en Colombia.
La propiedad ${propiedadEncontrada.ref} NO esta disponible actualmente.
Tienes estas propiedades disponibles:
${catalogoDisponible}

INSTRUCCIONES:
- Informa amablemente que esa propiedad no esta disponible
- Ofrece la opcion mas similar del catalogo con su ficha completa
- Pregunta si quiere que un asesor lo contacte cuando haya algo en esa zona
- Usa emojis suaves
- Sin asteriscos sin guiones sin negritas
- Maximo 4 oraciones`;

  } else if (propiedadEncontrada && propiedadEncontrada.disponible === "SI") {
    conv.estado = "ofreciendo_asesor";
    conv.linkUltima = propiedadEncontrada.link;
    const p = propiedadEncontrada;
    systemPrompt = `Eres un asesor inmobiliario profesional de Paraiso Inmobiliario en Colombia.
Presenta esta propiedad usando EXACTAMENTE este formato con emojis suaves:

🏠 [Titulo atractivo]

📍 Ubicacion: [zona y ciudad]
💰 Precio: [precio]
📐 Area: [area] | 🛏 Hab: [num] | 🚿 Banos: [num] | 🚗 Garaje: [num]
⭐ Estrato: [num] | 🏢 Admon: [valor]

[Descripcion atractiva en 2 oraciones]

📸 Ver fotos: ${p.link}

Para hablar con un asesor responde SI o escribe al 3028536489

Ficha: Ref ${p.ref} | ${p.titulo} | Precio: ${p.precio} | ${p.zona}, ${p.ciudad} | ${p.area} | ${p.habitaciones} hab | ${p.banos} ban | Garaje: ${p.garaje} | Estrato: ${p.estrato} | Admon: ${p.administracion} | ${p.descripcion} | ${p.caracteristicas} | Link: ${p.link}`;

  } else {
    conv.estado = "ofreciendo_asesor";
    systemPrompt = `Eres un asesor inmobiliario profesional de Paraiso Inmobiliario en Colombia.

Catalogo disponible:
${catalogoDisponible}

REGLAS IMPORTANTES:
1. Usa emojis suaves para hacer el mensaje mas cercano y personal
2. Responde sin asteriscos sin guiones sin negritas
3. Maximo 3 oraciones salvo cuando presentes una ficha completa
4. Si el usuario describe lo que busca recomienda la propiedad mas cercana del catalogo mencionando su referencia
5. Si no hay nada exacto ofrece la opcion mas similar y di que puedes avisarle cuando haya algo que encaje mejor
6. Si el usuario insiste en algo que no tienes di: "No tenemos esa opcion ahora pero nuestro asesor puede buscarte opciones personalizadas. Responde SI para que te contacte."
7. Nunca dejes ir a un cliente sin ofrecerle una alternativa o el contacto del asesor
8. Si el usuario da su nombre usalo para personalizar la conversacion
9. Cuando recomiendes una propiedad especifica presenta SIEMPRE la ficha completa con este formato:

🏠 [Titulo atractivo]

📍 Ubicacion: [zona y ciudad]
💰 Precio: [precio]
📐 Area: [area] | 🛏 Hab: [num] | 🚿 Banos: [num] | 🚗 Garaje: [num]
⭐ Estrato: [num] | 🏢 Admon: [valor]

[Descripcion en 2 oraciones]

📸 Ver fotos: [link exacto del catalogo]

Para hablar con un asesor responde SI`;
  }

  const historialClaude = conv.historial.slice(-6).map(h => ({
    role: h.role,
    content: h.content
  }));

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1000,
    system: systemPrompt,
    messages: historialClaude,
  });

  const reply = response.content[0].text;
  conv.historial.push({ role: "assistant", content: reply });

  // Detectar si Claude recomendo una propiedad y guardar su link
  for (const ref in propiedades) {
    if (reply.includes(ref) && propiedades[ref].link) {
      conv.linkUltima = propiedades[ref].link;
      break;
    }
  }

  await enviarMensaje(userPhone, reply);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot corriendo en puerto ${PORT}`));