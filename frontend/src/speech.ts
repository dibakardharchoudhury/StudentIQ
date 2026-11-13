import { ApiError, type Language, type Preferences, type SpeechToken } from './api';

type SDK = typeof import('microsoft-cognitiveservices-speech-sdk');
type Recognizer = import('microsoft-cognitiveservices-speech-sdk').SpeechRecognizer;
type Synthesizer = import('microsoft-cognitiveservices-speech-sdk').SpeechSynthesizer;
type AudioConfig = import('microsoft-cognitiveservices-speech-sdk').AudioConfig;

class SpeechError extends Error {}

export const speechLocale = (language: Language) => language === 'nb' ? 'nb-NO' : 'en-US';
export const speechVoice = (language: Language, voice: Preferences['voice'] = 'default') => language === 'nb'
  ? voice === 'alternate' ? 'nb-NO-FinnNeural' : 'nb-NO-PernilleNeural'
  : voice === 'alternate' ? 'en-US-AriaNeural' : 'en-US-JennyNeural';

export class Speech {
  private generation = 0;
  private stream?: MediaStream;
  private recognizer?: Recognizer;
  private synthesizer?: Synthesizer;
  private input?: AudioConfig;
  private audio?: HTMLAudioElement;
  private audioUrl?: string;
  private settle?: () => void;
  private timer?: ReturnType<typeof setTimeout>;
  private request?: AbortController;
  private stopped = true;
  private text = '';
  private finish?: (text: string) => void;
  private failure?: (error: Error) => void;
  constructor(
    private token: (signal: AbortSignal) => Promise<SpeechToken>,
    private onSpeaking: (active: boolean) => void,
  ) {}

  get active() { return !this.stopped; }

  async listen(language: Language, transcript: (text: string) => void, failed: (error: Error) => void) {
    this.cancel();
    const generation = this.generation;
    this.stopped = false;
    this.finish = transcript;
    this.failure = failed;
    this.text = '';
    this.request = new AbortController();
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone requires HTTPS and a supported browser. You can always type.');
      }
      const sdk = await import('microsoft-cognitiveservices-speech-sdk');
      if (generation !== this.generation) return;
      sdk.Recognizer.enableTelemetry(false);
      const authorization = await this.token(this.request.signal);
      if (generation !== this.generation) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      this.timer = setTimeout(() => this.stopListening(), 30_000);
      const config = sdk.SpeechConfig.fromAuthorizationToken(authorization.token, authorization.region);
      config.speechRecognitionLanguage = speechLocale(language);
      this.input = sdk.AudioConfig.fromStreamInput(stream);
      const recognizer = new sdk.SpeechRecognizer(config, this.input);
      this.recognizer = recognizer;
      recognizer.recognized = (_, event) => {
        if (generation === this.generation && event.result.reason === sdk.ResultReason.RecognizedSpeech) {
          this.text = `${this.text} ${event.result.text}`.trim();
        }
      };
      recognizer.canceled = (_, event) => {
        if (generation !== this.generation || this.stopped) return;
        this.fail(new Error(event.reason === sdk.CancellationReason.Error
          ? 'Azure speech recognition failed. Check permission, region and speech configuration; you can type instead.'
          : 'Speech recognition was canceled. You can type instead.'));
      };
      recognizer.sessionStopped = () => {
        if (generation === this.generation && !this.stopped) this.stopListening();
      };
      await new Promise<void>((resolve, reject) => recognizer.startContinuousRecognitionAsync(resolve, reject));
      if (generation !== this.generation) return;
    } catch (error) {
      if (generation !== this.generation) return;
      this.fail(error instanceof ApiError ? error :
        new Error('Could not start the microphone. Check microphone permission, connection and Azure Speech setup, or type instead.'));
    }
  }

  stopListening() {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.timer);
    // Stop physical capture immediately, not after an SDK/network callback.
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = undefined;
    const recognizer = this.recognizer;
    const generation = this.generation;
    const complete = () => {
      if (generation !== this.generation) return;
      const text = this.text;
      const finish = this.finish;
      this.cancel();
      finish?.(text);
    };
    if (recognizer) {
      // Bound the finalization wait if the speech connection disappears.
      this.timer = setTimeout(complete, 1500);
      recognizer.stopContinuousRecognitionAsync(complete, complete);
    } else {
      complete();
    }
  }

  async say(text: string, language: Language, voice: Preferences['voice'] = 'default') {
    this.cancel();
    const generation = this.generation;
    this.request = new AbortController();
    try {
      const sdk: SDK = await import('microsoft-cognitiveservices-speech-sdk');
      if (generation !== this.generation) return;
      sdk.Recognizer.enableTelemetry(false);
      const authorization = await this.token(this.request.signal);
      if (generation !== this.generation) return;
      const config = sdk.SpeechConfig.fromAuthorizationToken(authorization.token, authorization.region);
      config.speechSynthesisLanguage = speechLocale(language);
      config.speechSynthesisVoiceName = speechVoice(language, voice);
      config.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3;
      // Own playback explicitly to surface autoplay failures and revoke all audio URLs.
      this.synthesizer = new sdk.SpeechSynthesizer(config, null);
      const data = await new Promise<ArrayBuffer | undefined>((resolve, reject) => {
        this.settle = () => resolve(undefined);
        this.synthesizer!.speakTextAsync(text, result => {
          if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) resolve(result.audioData);
          else reject(new SpeechError('Azure speech could not play this reply. The text is still available.'));
        }, () => reject(new SpeechError('Speech playback failed. The text is still available.')));
      });
      if (generation !== this.generation) return;
      if (!data?.byteLength) throw new SpeechError('Azure speech returned no audio. The text is still available.');
      this.settle = undefined;
      this.synthesizer.close();
      this.synthesizer = undefined;
      this.audioUrl = URL.createObjectURL(new Blob([data], { type: 'audio/mpeg' }));
      const audio = new Audio(this.audioUrl);
      this.audio = audio;
      await new Promise<void>((resolve, reject) => {
        this.settle = resolve;
        audio.onplaying = () => { if (generation === this.generation) this.onSpeaking(true); };
        audio.onended = () => { if (generation === this.generation) this.cancel(); };
        audio.onerror = () => reject(new SpeechError('Audio playback failed. Read the text reply instead.'));
        void audio.play().catch(() => reject(new SpeechError('Audio playback was blocked. Use Read reply aloud, or read the text.')));
      });
    } catch (error) {
      if (generation !== this.generation) return;
      this.cancel();
      // SDK error strings are not safe diagnostics: they may contain credentials.
      throw error instanceof ApiError || error instanceof SpeechError ? error :
        new SpeechError('Azure speech playback failed. The text is still available.');
    }
  }

  private fail(error: Error) {
    const failed = this.failure;
    this.cancel();
    failed?.(error);
  }

  cancel() {
    this.generation++;
    this.stopped = true;
    this.request?.abort();
    this.request = undefined;
    this.settle?.();
    this.settle = undefined;
    clearTimeout(this.timer);
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = undefined;
    this.recognizer?.close();
    this.recognizer = undefined;
    this.input?.close();
    this.input = undefined;
    this.synthesizer?.close();
    this.synthesizer = undefined;
    if (this.audio) {
      this.audio.onplaying = null;
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      this.audio = undefined;
    }
    if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
    this.audioUrl = undefined;
    this.finish = undefined;
    this.failure = undefined;
    this.onSpeaking(false);
  }
}
