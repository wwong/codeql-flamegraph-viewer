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
