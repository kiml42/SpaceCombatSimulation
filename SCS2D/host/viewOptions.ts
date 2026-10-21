/**
 * What a view draws, as a row of buttons floating over the middle of its top
 * edge, as the ship editor has them in its corner: each names a setting as it
 * stands and changes it when pressed, beside the key that does the same.
 */

export interface ViewOption {
  /** What the button reads, as the setting stands. */
  label(): string;
  title: string;
  press(): void;
}

export interface ViewOptions {
  /** Read every setting again, after a key has changed one. */
  refresh(): void;
}

export function viewOptions(over: HTMLElement, options: readonly ViewOption[]): ViewOptions {
  const bar = document.createElement('div');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'What the view shows');
  Object.assign(bar.style, {
    position: 'absolute',
    display: 'flex',
    gap: '0.4rem',
    padding: '0.35rem',
    background: '#0b0f16cc',
    border: '1px solid #1c2533',
    borderRadius: '6px',
    top: '0.6rem',
    left: '50%',
    transform: 'translateX(-50%)',
  });
  const buttons = options.map((option) => {
    const button = document.createElement('button');
    button.title = option.title;
    // Never focused, so Space goes on pausing the battle rather than pressing it again.
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      option.press();
      refresh();
    });
    bar.append(button);
    return button;
  });
  const refresh = (): void => {
    options.forEach((option, k) => {
      buttons[k]!.textContent = option.label();
    });
  };
  refresh();
  over.append(bar);
  return { refresh };
}
