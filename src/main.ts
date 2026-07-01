import "./style.css";
import { createStage } from "./core/stage";

createStage();
void import("./app").catch((error) => {
  console.error("Microtonal Basin could not start.", error);
});
