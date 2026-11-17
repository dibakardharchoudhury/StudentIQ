import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Speech } from './speech';

const state = vi.hoisted(() => ({
  configure: vi.fn(() => ({})),
  ssml: vi.fn(),
  recognizers: [] as {
    recognized?: (_: unknown, event: unknown) => void; close: ReturnType<typeof vi.fn>;
    recognizing?: (_: unknown, event: unknown) => void;
    stopContinuousRecognitionAsync: ReturnType<typeof vi.fn>;
  }[],
  outputs: [] as { close: ReturnType<typeof vi.fn> }[],
  synthesizers: [] as { close: ReturnType<typeof vi.fn> }[],
}));
vi.mock('microsoft-cognitiveservices-speech-sdk', () => ({
  SpeechConfig: { fromAuthorizationToken: state.configure },
  PropertyId: { Speech_SegmentationSilenceTimeoutMs: 1, SpeechServiceConnection_InitialSilenceTimeoutMs: 2 },
  Recognizer: { enableTelemetry: vi.fn() },
  SpeechSynthesisOutputFormat: { Audio24Khz48KBitRateMonoMp3: 1 },
  AudioConfig: {
    fromStreamInput: vi.fn(() => {
      const input = { close: vi.fn() }; state.outputs.push(input); return input;
    }),
  },
  SpeechRecognizer: class {
    recognized?: (_: unknown, event: unknown) => void;
    recognizing?: (_: unknown, event: unknown) => void;
    close = vi.fn();
    stopContinuousRecognitionAsync = vi.fn((done: () => void) => done());
    startContinuousRecognitionAsync = vi.fn((done: () => void) => done());
    constructor() { state.recognizers.push(this); }
  },
  SpeechSynthesizer: class {
    close = vi.fn();
    constructor() { state.synthesizers.push(this); }
    speakSsmlAsync = (text: string, done: (value: unknown) => void) => {
      state.ssml(text);
      done({ reason: 7, audioData: new ArrayBuffer(8) });
    };
  },
  ResultReason: { RecognizedSpeech: 3, SynthesizingAudioCompleted: 7 },
}));

beforeEach(() => {
  state.recognizers.length = 0; state.outputs.length = 0; state.synthesizers.length = 0;
  state.configure.mockReset(); state.configure.mockImplementation(() => ({ setProperty: vi.fn() }));
  state.ssml.mockReset();
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('push-to-talk microphone lifecycle', () => {
  it('collects multiple phrases across brief pauses and shows the complete turn before submitting once', async () => {
    vi.useFakeTimers();
    try {
      const stop = vi.fn();
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) }, configurable: true,
      });
      const transcript = vi.fn(), partial = vi.fn(), ready = vi.fn();
      const speech = new Speech(async () => ({ token: 'test-token', region: 'norwayeast' }), vi.fn());
      await speech.listen('en', transcript, vi.fn(), { partial, ready });
      expect(ready).toHaveBeenCalledOnce();
      state.recognizers[0].recognizing?.(null, { result: { text: 'I would like' } });
      expect(partial).toHaveBeenCalledWith('I would like');
      expect(transcript).not.toHaveBeenCalled();
      state.recognizers[0].recognized?.(null, { result: { reason: 3, text: 'I would like a hint.' } });
      expect(transcript).not.toHaveBeenCalled();
      vi.advanceTimersByTime(800);
      state.recognizers[0].recognizing?.(null, { result: { text: 'Can you explain' } });
      expect(partial).toHaveBeenLastCalledWith('I would like a hint. Can you explain');
      vi.advanceTimersByTime(1200);
      expect(stop).not.toHaveBeenCalled();
      state.recognizers[0].recognized?.(null, { result: { reason: 3, text: 'Can you explain melting?' } });
      vi.advanceTimersByTime(1000);
      expect(transcript).toHaveBeenCalledExactlyOnceWith('I would like a hint. Can you explain melting?');
      expect(stop).toHaveBeenCalledOnce();
      const partialCalls = partial.mock.calls.length;
      state.recognizers[0].recognizing?.(null, { result: { text: 'late words' } });
      expect(partial).toHaveBeenCalledTimes(partialCalls);
    } finally { vi.useRealTimers(); }
  });
  it('cancels a pending turn boundary without sending its partial transcript', async () => {
    vi.useFakeTimers();
    try {
      const stop = vi.fn();
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) }, configurable: true,
      });
      const transcript = vi.fn();
      const speech = new Speech(async () => ({ token: 'test-token', region: 'norwayeast' }), vi.fn());
      await speech.listen('en', transcript, vi.fn(), { partial: vi.fn(), ready: vi.fn() });
      state.recognizers[0].recognized?.(null, { result: { reason: 3, text: 'An unfinished thought.' } });
      speech.cancel();
      vi.advanceTimersByTime(120_000);
      expect(transcript).not.toHaveBeenCalled();
      expect(stop).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it('allows a guided answer longer than 30 seconds but still bounds continuous capture to two minutes', async () => {
    vi.useFakeTimers();
    try {
      const stop = vi.fn();
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) }, configurable: true,
      });
      const transcript = vi.fn();
      const speech = new Speech(async () => ({ token: 'test-token', region: 'norwayeast' }), vi.fn());
      await speech.listen('en', transcript, vi.fn(), { partial: vi.fn(), ready: vi.fn() });
      for (let elapsed = 25_000; elapsed <= 100_000; elapsed += 25_000) {
        vi.advanceTimersByTime(25_000);
        state.recognizers[0].recognizing?.(null, { result: { text: 'Still explaining my answer' } });
        expect(speech.active).toBe(true);
      }
      vi.advanceTimersByTime(19_999);
      expect(stop).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(stop).toHaveBeenCalledOnce();
      expect(transcript).toHaveBeenCalledOnce();
      expect(speech.active).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it('gives a guided learner a full minute to begin before pausing an empty turn', async () => {
    vi.useFakeTimers();
    try {
      const stop = vi.fn();
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) }, configurable: true,
      });
      const transcript = vi.fn();
      const speech = new Speech(async () => ({ token: 'test-token', region: 'norwayeast' }), vi.fn());
      await speech.listen('en', transcript, vi.fn(), { partial: vi.fn(), ready: vi.fn() });
      vi.advanceTimersByTime(59_999);
      expect(stop).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(stop).toHaveBeenCalledOnce();
      expect(transcript).toHaveBeenCalledExactlyOnceWith('');
    } finally { vi.useRealTimers(); }
  });
  it('requests audio only on listen and immediately stops tracks on release, then emits the transcript', async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] });
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
    const transcript = vi.fn();
    const aadToken = 'aad#/subscriptions/test/resourceGroups/test/providers/Microsoft.CognitiveServices/accounts/speech#test-only-entra-token';
    const speech = new Speech(async () => ({ token: aadToken, region: 'norwayeast' }), vi.fn());
    expect(getUserMedia).not.toHaveBeenCalled();
    await speech.listen('nb', transcript, vi.fn());
    expect(state.configure).toHaveBeenCalledWith(aadToken, 'norwayeast');
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
    state.recognizers[0].recognized?.(null, { result: { reason: 3, text: 'Et testspørsmål' } });
    speech.stopListening();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(transcript).toHaveBeenCalledWith('Et testspørsmål');
    expect(state.recognizers[0].close).toHaveBeenCalled();
    expect(state.outputs[0].close).toHaveBeenCalled();
    speech.cancel();
  });
  it('stops a late microphone stream if the user released while permission was pending', async () => {
    const stop = vi.fn();
    let permit!: (stream: unknown) => void;
    const getUserMedia = vi.fn(() => new Promise(resolve => { permit = resolve; }));
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
    const speech = new Speech(async () => ({ token: 'test-token', region: 'norwayeast' }), vi.fn());
    const pending = speech.listen('en', vi.fn(), vi.fn());
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    speech.stopListening();
    permit({ getTracks: () => [{ stop }] });
    await pending;
    expect(stop).toHaveBeenCalledOnce();
    expect(state.recognizers).toHaveLength(0);
  });
  it('reports permission errors without retaining an active microphone', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true,
    });
    const failed = vi.fn();
    const speech = new Speech(async () => ({ token: 'test-token', region: 'norwayeast' }), vi.fn());
    await speech.listen('en', vi.fn(), failed);
    expect(failed).toHaveBeenCalledWith(expect.any(Error));
    expect(speech.active).toBe(false);
    expect(state.recognizers).toHaveLength(0);
  });
  it('caps microphone capture at 30 seconds', async () => {
    vi.useFakeTimers();
    try {
      const stop = vi.fn();
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) }, configurable: true,
      });
      const transcript = vi.fn();
      const speech = new Speech(async () => ({ token: 'test-token', region: 'norwayeast' }), vi.fn());
      await speech.listen('en', transcript, vi.fn());
      vi.advanceTimersByTime(30_000);
      expect(stop).toHaveBeenCalledOnce();
      expect(speech.active).toBe(false);
      expect(transcript).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
});

describe('Azure synthesis playback lifecycle', () => {
  function audioFixture(block = false) {
    const audio = {
      pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn(),
      onplaying: null as null | (() => void),
      onended: null as null | (() => void),
      onerror: null as null | (() => void),
      play: vi.fn(() => block ? Promise.reject(new Error('autoplay blocked')) : Promise.resolve()),
    };
    vi.stubGlobal('Audio', class { constructor() { return audio; } });
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:test-only-audio'), revokeObjectURL: revoke });
    return { audio, revoke };
  }
  it('uses Azure audio without requesting microphone and cancels playback/resources on mute', async () => {
    const { audio, revoke } = audioFixture();
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
    const speaking = vi.fn();
    const aadToken = 'aad#/subscriptions/test/resourceGroups/test/providers/Microsoft.CognitiveServices/accounts/speech#test-only-entra-token';
    const speech = new Speech(async () => ({ token: aadToken, region: 'norwayeast' }), speaking);
    const pending = speech.say('Test fixture text', 'nb');
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalled());
    expect(state.configure).toHaveBeenCalledWith(aadToken, 'norwayeast');
    audio.onplaying?.();
    expect(speaking).toHaveBeenLastCalledWith(true);
    speech.cancel();
    await pending;
    expect(audio.pause).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith('blob:test-only-audio');
    expect(state.synthesizers[0].close).toHaveBeenCalled();
    expect(speaking).toHaveBeenLastCalledWith(false);
    expect(getUserMedia).not.toHaveBeenCalled();
  });
  it('reports autoplay failure instead of silently claiming audio played', async () => {
    const { revoke } = audioFixture(true);
    const speech = new Speech(async () => ({ token: 'test-token', region: 'norwayeast' }), vi.fn());
    await expect(speech.say('Test fixture text', 'en')).rejects.toThrow('playback was blocked');
    expect(revoke).toHaveBeenCalledWith('blob:test-only-audio');
  });
  it('uses conversational SSML with gentle pacing and escapes text rather than interpreting markup', async () => {
    const { audio } = audioFixture();
    const speech = new Speech(async () => ({ token: 'test-token', region: 'norwayeast' }), vi.fn());
    const pending = speech.say('Hello <friend> & welcome!', 'en');
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalled());
    expect(state.ssml).toHaveBeenCalledWith(expect.stringContaining('<mstts:express-as style="chat">'));
    expect(state.ssml).toHaveBeenCalledWith(expect.stringContaining('<prosody rate="-8%">Hello &lt;friend&gt; &amp; welcome!</prosody>'));
    audio.onended?.();
    await pending;
  });
  it('does not expose raw SDK diagnostics that could include an Entra credential', async () => {
    state.configure.mockImplementation(() => { throw new Error('SDK diagnostic containing aad#resource#private-test-token'); });
    const speech = new Speech(async () => ({ token: 'aad#resource#private-test-token', region: 'norwayeast' }), vi.fn());
    const log = vi.spyOn(console, 'log');
    const error = vi.spyOn(console, 'error');
    await expect(speech.say('Test fixture text', 'en')).rejects.toThrow('Azure speech playback failed.');
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
  it.each([
    ['en', 'en-US-AriaNeural'],
    ['nb', 'nb-NO-FinnNeural'],
  ] as const)('uses the alternate compatible %s voice in the actual Azure SDK configuration', async (language, voice) => {
    const { audio } = audioFixture();
    const speech = new Speech(async () => ({ token: 'aad#test-resource#test-token', region: 'norwayeast' }), vi.fn());
    const pending = speech.say('Test voice selection', language, 'alternate');
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalled());
    expect(state.configure.mock.results[0].value).toMatchObject({ speechSynthesisVoiceName: voice });
    speech.cancel(); await pending;
  });
});
