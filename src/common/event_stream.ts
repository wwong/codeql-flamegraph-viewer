import { LineStream } from "./line_stream";

/**
 * An event listener for events of type `T`.
 */
export type Listener<T> = (event: T) => void;

/**
 * A list of event handlers for a given type of event.
 *
 * An object that exposes an event stream in a field will typically fire
 * its events, while users of the object can listen to the stream.
 */
export class EventStream<T> {
    public listeners: Listener<T>[] = [];

    /** Calls all listeners with the given event. */
    public fire(event: T) {
        for (let listener of this.listeners) {
            listener(event);
        }
    }

    /** Adds an event listener to be invoked when an event is fired. */
    public listen(listener: Listener<T>) {
        this.listeners.push(listener);
    }
}

/**
 * Helper for composing long streams before firing off the input events.
 *
 * Correct use of streams requires that all the listeners have been added before any
 * events are fired. Otherwise the events are lost, or you are forced to buffer the events.
 *
 * The stream builder encapsulates a value of type `T` which is considered "ready" once the underlying
 * events have been fired. The `.get` method unboxes the value, but triggers the underlying events
 * before returning.
 */
export class StreamBuilder<T> {
    constructor(
        private readonly fire: () => void,
        private readonly value: T) {}

    then<R>(transformer: (t: T) => R): StreamBuilder<R> {
        return new StreamBuilder(this.fire, transformer(this.value));
    }

    /** Like `then` but invokes the transformer as a constructor. */
    thenNew<R>(transformer: new (t: T) => R): StreamBuilder<R> {
        return new StreamBuilder(this.fire, new transformer(this.value));
    }

    /** Fires all input events and then returns the boxed value. */
    get(): T {
        this.fire();
        return this.value;
    }
}
