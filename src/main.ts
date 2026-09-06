import "./style.css";
import { createStage, type Stage } from "./core/stage";
import { createApp, type BasinApp } from "./app";

const unsupportedMessage = "This piece needs a browser with WebGL support enabled.";
const contextLostMessage = "The graphics context was lost. Reload to bring the basin back.";
const waterLab = import.meta.env.DEV && new URLSearchParams(window.location.search).has("waterLab");

function showFallback(message: string) {
  const fallback = document.getElementById("basin-fallback");
  if (!fallback) {
    return;
  }

  const paragraph = fallback.querySelector("p");
  if (paragraph) {
    paragraph.textContent = message;
  }
  fallback.hidden = false;
}

function hideFallback() {
  const fallback = document.getElementById("basin-fallback");
  if (fallback) {
    fallback.hidden = true;
  }
}

let stage: Stage | null = null;
let app: BasinApp | null = null;

// A backgrounded mobile tab, a driver reset, or a GPU process crash can take
// the WebGL context away at any moment. Without preventDefault() the browser
// will never issue a restore, so the canvas would stay blank for good — the
// most likely real failure for a piece meant to sit open for hours.
function handleContextLost(event: Event) {
  event.preventDefault();
  // Every GPU object the app holds — render targets, textures, programs — died
  // with the context, so the app goes too. The Stage's renderer stays: three
  // reinitializes its own GL state on restore, and keeping it keeps the canvas
  // and its listeners in place. The message covers the case where the restore
  // never arrives; it is cleared the moment it does.
  app?.dispose();
  app = null;
  showFallback(contextLostMessage);
}

function handleContextRestored() {
  if (!stage || app) {
    return;
  }

  try {
    // No second title sequence: the viewer already performed the ritual, and
    // replaying it would read as the piece restarting rather than recovering.
    app = createApp(stage, { skipIntro: true, waterLab });
    hideFallback();
  } catch (error) {
    console.error("clinamen could not recover its WebGL context.", error);
    showFallback(contextLostMessage);
  }
}

// createStage() builds the WebGL renderer synchronously, so an unsupported
// browser throws here and gets the fallback instead of a blank page.
try {
  stage = createStage();
  const canvas = stage.renderer.domElement;
  canvas.addEventListener("webglcontextlost", handleContextLost);
  canvas.addEventListener("webglcontextrestored", handleContextRestored);

  const skipIntro = import.meta.env.DEV &&
    new URLSearchParams(window.location.search).has("skipIntro");
  app = createApp(stage, { skipIntro: skipIntro || waterLab, waterLab });
} catch (error) {
  console.error("clinamen could not start.", error);
  showFallback(unsupportedMessage);
}

if (import.meta.hot) {
  // Everything the app owns is rebuildable now, so a hot reload tears the whole
  // thing down — there are no shared module-level resources left to preserve.
  import.meta.hot.dispose(() => {
    app?.dispose();
    app = null;
    stage?.dispose();
    stage = null;
  });
}
