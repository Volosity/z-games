// demo.js — the demo driver: walks DEMO_STEPS, issuing each command
// through the shell's own sendCommand path (the demo plays the real
// product, not a recording of it), showing each caption, and pacing
// itself by the narration — a step never starts while the previous
// turn is still being spoken, and never waits less than its floor.
export class DemoDriver {
  constructor({ issue, caption, whenIdle, minStepMs = 4200 }) {
    this.issue = issue;
    this.caption = caption;
    this.whenIdle = whenIdle;
    this.minStepMs = minStepMs;
    this.stopped = false;
  }
  stop() { this.stopped = true; }
  // Pace one step: narration idle AND the step's floor elapsed,
  // whichever is later — but a stop lands within a quarter second,
  // never at the end of a long narration.
  async pace(floorMs) {
    const t0 = Date.now();
    let idle = false;
    const idleP = Promise.resolve(this.whenIdle()).then(() => { idle = true; }, () => { idle = true; });
    void idleP;
    while (!this.stopped && (!idle || Date.now() - t0 < floorMs)) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  async run(steps) {
    if (this.running) return { completed: 0, stopped: true };
    this.running = true;
    this.stopped = false;
    try {
      for (let i = 0; i < steps.length; i++) {
        if (this.stopped) return { completed: i, stopped: true };
        const step = steps[i];
        if (step.caption) await this.caption(step.caption, i, steps.length);
        if (this.stopped) return { completed: i, stopped: true };
        if (step.cmd) await this.issue(step.cmd);
        await this.pace(step.waitMs ?? this.minStepMs);
        if (this.stopped) return { completed: i + 1, stopped: true };
      }
      return { completed: steps.length, stopped: false };
    } finally { this.running = false; }
  }
}
