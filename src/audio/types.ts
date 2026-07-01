export type ActiveAudioVoice = {
  gain: GainNode;
  timeoutId: number;
};

export type HoldableAudioParam = AudioParam & {
  cancelAndHoldAtTime?: (cancelTime: number) => AudioParam;
};
