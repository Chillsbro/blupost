export function terminalIsInteractive(
  stdinIsTty: boolean | undefined,
  stdoutIsTty: boolean | undefined
): boolean {
  return stdinIsTty === true && stdoutIsTty === true;
}

interface Transition {
  startedAt: number;
  duration: number;
  update: (progress: number) => void;
  complete?: (() => void) | undefined;
}

export interface MotionControllerOptions {
  animated: boolean;
  requestFrame: () => void;
  now?: (() => number) | undefined;
  autoSchedule?: boolean | undefined;
}

function easeOutCubic(value: number): number {
  return 1 - (1 - value) ** 3;
}

/** Blends two six-digit theme colors for short, state-driven feedback. */
export function mixHexColors(from: string, to: string, progress: number): string {
  const amount = Math.min(1, Math.max(0, progress));
  const fromValue = Number.parseInt(from.slice(1), 16);
  const toValue = Number.parseInt(to.slice(1), 16);
  const channel = (shift: number): number => {
    const start = (fromValue >> shift) & 0xff;
    const end = (toValue >> shift) & 0xff;
    return Math.round(start + (end - start) * amount);
  };
  return `#${[channel(16), channel(8), channel(0)]
    .map(value => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

export class MotionController {
  private transitions = new Map<string, Transition>();
  private repeats = new Set<string>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly now: () => number;

  constructor(private readonly options: MotionControllerOptions) {
    this.now = options.now ?? (() => performance.now());
  }

  get idle(): boolean {
    return this.transitions.size === 0;
  }

  animate(
    name: string,
    durationMs: number,
    update: (progress: number) => void,
    complete?: () => void
  ): void {
    this.cancel(name);
    if (!this.options.animated) {
      update(1);
      complete?.();
      this.options.requestFrame();
      return;
    }
    this.begin(name, durationMs, update, complete);
  }

  repeat(name: string, durationMs: number, update: (progress: number) => void): void {
    this.cancel(name);
    if (!this.options.animated) {
      update(0);
      this.options.requestFrame();
      return;
    }
    this.repeats.add(name);
    const cycle = (): void => {
      this.begin(name, durationMs, update, () => {
        if (this.repeats.has(name)) cycle();
      });
    };
    cycle();
  }

  private begin(
    name: string,
    duration: number,
    update: (progress: number) => void,
    complete?: () => void
  ): void {
    this.transitions.set(name, {
      startedAt: this.now(),
      duration,
      update,
      complete
    });
    update(0);
    this.ensureTimer();
    this.options.requestFrame();
  }

  cancel(name: string, finish = false): void {
    this.repeats.delete(name);
    const transition = this.transitions.get(name);
    if (!transition) return;
    this.transitions.delete(name);
    if (finish) transition.update(1);
    this.stopTimerIfIdle();
    this.options.requestFrame();
  }

  tick(at = this.now()): void {
    for (const [name, transition] of [...this.transitions]) {
      const linear = Math.min(
        1,
        Math.max(0, (at - transition.startedAt) / transition.duration)
      );
      transition.update(easeOutCubic(linear));
      if (linear >= 1) {
        this.transitions.delete(name);
        transition.complete?.();
      }
    }
    this.stopTimerIfIdle();
    this.options.requestFrame();
  }

  dispose(): void {
    this.repeats.clear();
    this.transitions.clear();
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private ensureTimer(): void {
    if (this.options.autoSchedule === false || this.timer) return;
    this.timer = setInterval(() => this.tick(), 16);
  }

  private stopTimerIfIdle(): void {
    if (!this.idle || !this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
