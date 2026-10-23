type Nullable<T> = T | null | undefined
declare function KtSingleton<T>(): T & (abstract new() => any);
export declare class ClockSync {
    constructor(window?: number);
    get offsetMs(): number;
    set offsetMs(value: number);
    get rttMs(): number;
    set rttMs(value: number);
    get synced(): boolean;
    onPong(sentLocalMs: number, serverTimeMs: number, receivedLocalMs: number): void;
    serverNow(localMs: number): number;
}
export declare namespace ClockSync {
    /** @deprecated $metadata$ is used for internal purposes, please don't use it in your code, because it can be removed at any moment */
    namespace $metadata$ {
        const constructor: abstract new () => ClockSync;
    }
}
export declare abstract class ServerMessage {
    private constructor();
}
export declare namespace ServerMessage {
    /** @deprecated $metadata$ is used for internal purposes, please don't use it in your code, because it can be removed at any moment */
    namespace $metadata$ {
        const constructor: abstract new () => ServerMessage;
    }
    class Hello extends ServerMessage.$metadata$.constructor {
        constructor(sessionId: string, serverTimeMs: number, protocol: number);
        get sessionId(): string;
        get serverTimeMs(): number;
        get protocol(): number;
        copy(sessionId?: string, serverTimeMs?: number, protocol?: number): ServerMessage.Hello;
        toString(): string;
        hashCode(): number;
        equals(other: Nullable<any>): boolean;
    }
    namespace Hello {
        /** @deprecated $metadata$ is used for internal purposes, please don't use it in your code, because it can be removed at any moment */
        namespace $metadata$ {
            const constructor: abstract new () => Hello;
        }
    }
    class Pong extends ServerMessage.$metadata$.constructor {
        constructor(clientTimeMs: number, serverTimeMs: number);
        get clientTimeMs(): number;
        get serverTimeMs(): number;
        copy(clientTimeMs?: number, serverTimeMs?: number): ServerMessage.Pong;
        toString(): string;
        hashCode(): number;
        equals(other: Nullable<any>): boolean;
    }
    namespace Pong {
        /** @deprecated $metadata$ is used for internal purposes, please don't use it in your code, because it can be removed at any moment */
        namespace $metadata$ {
            const constructor: abstract new () => Pong;
        }
    }
}
export declare abstract class ClientMessage {
    private constructor();
}
export declare namespace ClientMessage {
    /** @deprecated $metadata$ is used for internal purposes, please don't use it in your code, because it can be removed at any moment */
    namespace $metadata$ {
        const constructor: abstract new () => ClientMessage;
    }
    class Ping extends ClientMessage.$metadata$.constructor {
        constructor(clientTimeMs: number);
        get clientTimeMs(): number;
        copy(clientTimeMs?: number): ClientMessage.Ping;
        toString(): string;
        hashCode(): number;
        equals(other: Nullable<any>): boolean;
    }
    namespace Ping {
        /** @deprecated $metadata$ is used for internal purposes, please don't use it in your code, because it can be removed at any moment */
        namespace $metadata$ {
            const constructor: abstract new () => Ping;
        }
    }
}
export declare abstract class Protocol {
    static readonly getInstance: () => typeof Protocol.$metadata$.type;
    private constructor();
}
export declare namespace Protocol {
    /** @deprecated $metadata$ is used for internal purposes, please don't use it in your code, because it can be removed at any moment */
    namespace $metadata$ {
        abstract class type extends KtSingleton<constructor>() {
            private constructor();
        }
        abstract class constructor {
            get version(): number;
            encodeClient(message: ClientMessage): string;
            encodeServer(message: ServerMessage): string;
            decodeServer(json: string): Nullable<ServerMessage>;
            decodeClient(json: string): Nullable<ClientMessage>;
            ping(clientTimeMs: number): string;
            private constructor();
        }
    }
}
export declare abstract class Workspaces {
    static readonly getInstance: () => typeof Workspaces.$metadata$.type;
    private constructor();
}
export declare namespace Workspaces {
    /** @deprecated $metadata$ is used for internal purposes, please don't use it in your code, because it can be removed at any moment */
    namespace $metadata$ {
        abstract class type extends KtSingleton<constructor>() {
            private constructor();
        }
        abstract class constructor {
            get schema(): number;
            empty(): string;
            load(json: string): Nullable<string>;
            apply(stateJson: string, opsJson: string, nowMs: number, viewerJson: Nullable<string>): string;
            commandPose(stateJson: string): string;
            focusSlot(stateJson: string): string;
            previewPose(stateJson: string): string;
            panelScale(stateJson: string): number;
            private constructor();
        }
    }
}