/**
 * why: the remote's socket lives as long as the panel that shows it, as the picture's capture does:
 * leaving the page, the lease ending (the page then shows no lease) or the device changing closes
 * it. Nothing reconnects by itself; a refused or dropped socket waits for the reader to ask again,
 * because a daemon that refused once answers the same way on a loop.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  encodeButton,
  encodeKey,
  type InputSocket,
  inputProtocols,
  inputSocketUrl,
  parseServerMessage,
} from "../data/input";
import {
  keyControl,
  type RemoteControl,
  type RemotePhase,
  type RemoteSpec,
  type RemoteView,
  remoteView,
  sendOf,
} from "../model/remote";
import { useOpenInputSocket, useSession } from "./services";

export interface Remote extends RemoteView {
  readonly press: (control: RemoteControl) => void;
  // why: true when the key drove the remote, so the page keeps it from scrolling or leaving focus.
  readonly key: (key: string) => boolean;
  readonly connect: () => void;
}

export function useRemote(
  leaseId: string | undefined,
  platform: string,
  spec: RemoteSpec | undefined,
): Remote | undefined {
  const open = useOpenInputSocket();
  const session = useSession();
  const socket = useRef<InputSocket | undefined>(undefined);
  const [phase, setPhase] = useState<RemotePhase>({ kind: "connecting" });
  const [attempt, setAttempt] = useState(0);
  const enabled = leaseId !== undefined && spec !== undefined;

  useEffect(() => {
    if (!enabled) return undefined;
    let admitted = false;
    let ended = false;
    setPhase({ kind: "connecting" });
    const opened = open(inputSocketUrl(window.location, leaseId), inputProtocols(session.token()), {
      close: () => {
        if (ended) return;
        ended = true;
        socket.current = undefined;
        setPhase({ kind: admitted ? "closed" : "refused" });
      },
      message: (bytes) => {
        const message = parseServerMessage(bytes);
        if (message.kind === "admitted") admitted = true;
        if (message.kind !== "config") return;
        setPhase(
          message.inputUnavailable
            ? { kind: "unavailable" }
            : { keys: !message.keyboardUnavailable, kind: "ready" },
        );
      },
    });
    socket.current = opened;
    return () => {
      ended = true;
      socket.current = undefined;
      opened.close();
    };
  }, [enabled, leaseId, open, session, attempt]);

  const view = spec === undefined ? undefined : remoteView(spec, platform, phase);

  const press = useCallback(
    (control: RemoteControl) => {
      const button = view?.buttons.find((each) => each.control === control);
      if (button === undefined || button.disabled) return;
      const send = sendOf(control);
      if (send.kind === "button") {
        socket.current?.send(encodeButton(send.button));
        return;
      }
      socket.current?.send(encodeKey("down", send.usage));
      socket.current?.send(encodeKey("up", send.usage));
    },
    [view],
  );

  const connect = useCallback(() => setAttempt((count) => count + 1), []);

  if (!enabled || view === undefined) return undefined;
  return {
    ...view,
    connect,
    key: (key) => {
      if (!view.keyboard) return false;
      const control = keyControl(spec, key);
      if (control === undefined) return false;
      press(control);
      return true;
    },
    press,
  };
}
