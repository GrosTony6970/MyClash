/**
 * Escape closes only the top dialog (O25, operator 2026-10-14).
 *
 * Each dialog used to listen for Escape on `document` by itself, so a question opened over a
 * window closed both at one press. Asking each dialog "am I on top?" is not enough: a real key
 * press can commit the top dialog's close between two listeners, and the one under it then finds
 * itself on top. So there is ONE listener, and it hands each Escape to the top layer only.
 *
 * A layer is pushed when its dialog opens and removed when it closes, so the order is the order
 * of opening. An Escape a control already handled (`defaultPrevented`, e.g. a list closing) is
 * left alone; the one a layer takes is marked handled.
 */

export interface KeyTarget {
  addEventListener(type: 'keydown', listener: (event: Event) => void): void;
  removeEventListener(type: 'keydown', listener: (event: Event) => void): void;
}

export interface DialogLayers {
  /** Push a layer; returns its removal. */
  open(onEscape: () => void): () => void;
  count(): number;
}

export function createDialogLayers(target: KeyTarget): DialogLayers {
  const layers: Array<{ onEscape: () => void }> = [];

  const onKeyDown = (event: Event) => {
    if ((event as KeyboardEvent).key !== 'Escape' || event.defaultPrevented) return;
    const top = layers[layers.length - 1];
    if (!top) return;
    event.preventDefault();
    top.onEscape();
  };

  return {
    open(onEscape) {
      const layer = { onEscape };
      if (layers.length === 0) target.addEventListener('keydown', onKeyDown);
      layers.push(layer);
      return () => {
        const at = layers.indexOf(layer);
        if (at < 0) return;
        layers.splice(at, 1);
        if (layers.length === 0) target.removeEventListener('keydown', onKeyDown);
      };
    },
    count: () => layers.length,
  };
}

let documentLayers: DialogLayers | null = null;

/** The page's one stack, on `document`. */
export function dialogLayers(): DialogLayers {
  documentLayers ??= createDialogLayers(document);
  return documentLayers;
}
