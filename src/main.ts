import "./style.css";
import { createStage } from "./core/stage";

function showFallback() {
  const fallback = document.getElementById("basin-fallback");
  if (fallback) {
    fallback.hidden = false;
  }
}

// createStage() builds the WebGL renderer synchronously, so an unsupported
// browser throws here rather than in the dynamic import below.
try {
  createStage();
  void import("./app").catch((error) => {
    console.error("Microtonal Basin could not start.", error);
    showFallback();
  });
} catch (error) {
  console.error("Microtonal Basin could not start.", error);
  showFallback();
}
