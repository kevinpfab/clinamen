export type DebugSlider = {
  element: HTMLLabelElement;
  input: HTMLInputElement;
  value: HTMLSpanElement;
  setValue: (nextValue: number) => void;
};
