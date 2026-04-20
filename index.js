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
  if (!message || message.type !== "text") return;
  if (value?.statuses) return;

  const userText = message.text.body.trim();
  const userPhone = message.from;

  // Inicializar conversacion si no existe
  if (!conversaciones[userPhone]) {
    conversaciones[userPhone] = {
      estado: "inicio",
      nombre: null,
      interes: null,
      historial: []
    };
  }

  const conv = conversaciones[userPhone];
  conv.historial.push({ role: "user", content: userText });

  // Detectar si quiere hablar con asesor
  const quiereAsesor = /\b(asesor|humano|persona|hablar con alguien|comunicar|contacto|agente)\b/i.test(userText);
const confirma = /^(si|sí|yes|claro|dale|quiero|me interesa|perfecto|ok|okay)$/i.test(userText.toLowerCase());

if (quiereAsesor || (confirma && conv.estado === "ofreciendo_asesor")) {
  const saludo = conv.nombre ? `Perfecto ${conv.nombre}` : `Perfecto`;
  const resumenFinal = conv.interes || conv.historial.filter(h => h.role === "user").map(h => h.content).join(", ");
  const msgAsesor = `${saludo}. Nuestro asesor se pondra en contacto contigo al ${userPhone} muy pronto. Si prefieres escribirle directamente hazlo al 3218939542 indicando que buscas: ${resumenFinal}.`;
  await enviarMensaje(userPhone, msgAsesor);
  conv.estado = "transferido";
  return;
}

  const propiedades = await getPropiedades();

  const disponibles = Object.values(propiedades).filter(p => p.disponible === "SI");
  const noDisponibles = Object.values(propiedades).filter(p => p.disponible !== "SI");

  const catalogoDisponible = disponibles.map(p =>
    `Ref ${p.ref}: ${p.titulo} | ${p.tipo} | ${p.precio} | ${p.area} | ${p.habitaciones} hab | ${p.banos} ban | Garaje: ${p.garaje} | Estrato ${p.estrato} | Admon: ${p.administracion} | ${p.zona}, ${p.ciudad}`
  ).join("\n");

  // Buscar propiedad especifica por ref
  let propiedadEncontrada = null;
  for (const ref in propiedades) {
    if (userText.includes(ref)) {
      propiedadEncontrada = propiedades[ref];
      break;
    }
  }

  // Extraer nombre del usuario si lo menciona
  const nombreMatch = userText.match(/(?:me llamo|soy|mi nombre es)\s+([A-Za-zÁáÉéÍíÓóÚú]+)/i);
  if (nombreMatch) conv.nombre = nombreMatch[1];

  let systemPrompt;

  if (propiedadEncontrada && propiedadEncontrada.disponible !== "SI") {
    conv.estado = "ofreciendo_asesor";
    conv.interes = `propiedad ${propiedadEncontrada.ref} en ${propiedadEncontrada.zona}`;
    systemPrompt = `Eres un asesor inmobiliario profesional en Colombia. 
La propiedad ${propiedadEncontrada.ref} NO esta disponible actualmente.
Tienes estas propiedades disponibles:
${catalogoDisponible}

INSTRUCCIONES:
- Informa que esa propiedad no esta disponible
- Ofrece la opcion mas similar del catalogo disponible
- Pregunta si quiere que un asesor lo contacte cuando haya algo en esa zona
- Responde en texto plano sin asteriscos sin guiones sin negritas sin emojis
- Maximo 3 oraciones`;

  } else if (propiedadEncontrada && propiedadEncontrada.disponible === "SI") {
    conv.estado = "ofreciendo_asesor";
    conv.interes = `propiedad ${propiedadEncontrada.ref} - ${propiedadEncontrada.titulo}`;
    const p = propiedadEncontrada;
    systemPrompt = `Eres un asesor inmobiliario profesional en Colombia. Presenta esta propiedad usando EXACTAMENTE este formato sin asteriscos sin guiones sin negritas sin emojis:

[Titulo atractivo en una linea]

Ubicacion: [zona y ciudad]
Precio: [precio]
Area: [area] | Hab: [num] | Banos: [num] | Garaje: [num]
Estrato: [num] | Admon: [valor]

[Descripcion atractiva en 2 oraciones]

Ver fotos: [link]

Para hablar con un asesor responde SI o escribe al 3218939542

Ficha: Ref ${p.ref} | ${p.titulo} | Precio: ${p.precio} | ${p.zona}, ${p.ciudad} | ${p.area} | ${p.habitaciones} hab | ${p.banos} ban | Garaje: ${p.garaje} | Estrato: ${p.estrato} | Admon: ${p.administracion} | ${p.descripcion} | ${p.caracteristicas} | Link: ${p.link}`;

  } else {
    conv.estado = "asesorando";
    systemPrompt = `Eres un asesor inmobiliario profesional en Colombia. 
Catalogo disponible:
${catalogoDisponible}
REGLAS IMPORTANTES:
1. Responde en texto plano sin asteriscos sin guiones sin negritas sin emojis
2. Maximo 3 oraciones
3. Si el usuario describe lo que busca recomienda la propiedad mas cercana del catalogo mencionando su referencia
4. Si no hay nada exacto ofrece la opcion mas similar y di que puedes avisarle cuando haya algo que encaje mejor
5. Si el usuario insiste en algo que no tienes di: "No tenemos esa opcion ahora pero nuestro asesor puede buscarte opciones personalizadas. Responde SI para que te contacte."
6. Si el usuario dice SI despues de ofrecer asesor responde: "Perfecto. Nuestro asesor te contactara al [numero del usuario] muy pronto. Si prefieres escribirle directamente hazlo al 3218939542."
7. Nunca dejes ir a un cliente sin ofrecerle una alternativa o el contacto del asesor
8. Si el usuario da su nombre guardalo para personalizar la conversacion
9. Cuando recomiendes una propiedad especifica presenta SIEMPRE la ficha completa con este formato exacto en lineas separadas:
[Titulo atractivo]

Ubicacion: [zona y ciudad]
Precio: [precio]
Area: [area] | Hab: [num] | Banos: [num] | Garaje: [num]
Estrato: [num] | Admon: [valor]

[Descripcion en 2 oraciones]

Ver fotos: [link]

Para hablar con un asesor responde SI`;
    conv.estado = "ofreciendo_asesor";
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

  await enviarMensaje(userPhone, reply);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot corriendo en puerto ${PORT}`));