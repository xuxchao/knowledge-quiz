import { onBeforeUnmount, shallowRef } from 'vue';

type SpeechState = 'idle' | 'playing' | 'paused';

export const useSpeechSynthesis = () => {
  const activeMessageKey = shallowRef<string | null>(null);
  const activeUtterance = shallowRef<SpeechSynthesisUtterance | null>(null);
  const state = shallowRef<SpeechState>('idle');
  const isSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const reset = (): void => {
    activeUtterance.value = null;
    activeMessageKey.value = null;
    state.value = 'idle';
  };

  const toggle = (messageKey: string, text: string): void => {
    if (!isSupported || !text.trim()) return;

    if (activeMessageKey.value === messageKey && state.value === 'playing') {
      window.speechSynthesis.pause();
      state.value = 'paused';
      return;
    }

    if (activeMessageKey.value === messageKey && state.value === 'paused') {
      window.speechSynthesis.resume();
      state.value = 'playing';
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    const resetCurrentUtterance = (): void => {
      if (activeUtterance.value === utterance) reset();
    };
    utterance.onend = resetCurrentUtterance;
    utterance.onerror = resetCurrentUtterance;

    activeUtterance.value = utterance;
    activeMessageKey.value = messageKey;
    state.value = 'playing';
    window.speechSynthesis.speak(utterance);
  };

  const isPlaying = (messageKey: string): boolean =>
    activeMessageKey.value === messageKey && state.value === 'playing';

  const buttonLabel = (messageKey: string): string =>
    isPlaying(messageKey)
      ? '暂停朗读'
      : activeMessageKey.value === messageKey
        ? '继续朗读'
        : '朗读消息';

  onBeforeUnmount(() => {
    if (isSupported) window.speechSynthesis.cancel();
    reset();
  });

  return {
    isSupported,
    toggle,
    isPlaying,
    buttonLabel,
  };
};
