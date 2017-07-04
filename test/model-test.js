import expect from 'expect';
import EventEmitter from 'events';
import { create } from '../src/index';

describe('app.model', () => {
  it('namespace: namespace should be defined', () => {
    const app = create();
    expect(() => {
      app.model({});
    }).toThrow(/\[app\.model\] namespace should be defined/);
  });

  it('namespace: unique error', () => {
    const app = create();
    expect(() => {
      app.model({
        namespace: 'repeat',
      });
      app.model({
        namespace: 'repeat',
      });
    }).toThrow(/\[app\.model\] namespace should be unique/);
  });

  it('dynamic model', () => {
    let count = 0;

    const app = create();
    app.model({
      namespace: 'users',
      state: [],
      reducers: {
        add(state, { payload }) {
          return [...state, payload];
        },
      },
    });
    app.start();

    // inject model
    app.model({
      namespace: 'tasks',
      state: [],
      reducers: {
        add(state, { payload }) {
          return [...state, payload];
        },
      },
      effects: {
        *add() {
          yield 1;
          count += 1;
        },
      },
      subscriptions: {
        setup() {
          count += 1;
        },
      },
    });

    // subscriptions
    expect(count).toEqual(1);

    // reducers
    app._store.dispatch({ type: 'tasks/add', payload: 'foo' });
    app._store.dispatch({ type: 'users/add', payload: 'foo' });
    const state = app._store.getState();
    expect(state.users).toEqual(['foo']);
    expect(state.tasks).toEqual(['foo']);

    // effects
    expect(count).toEqual(2);
  });

  it('don\'t inject if exists', () => {
    const app = create();

    const model = {
      namespace: 'count',
      state: 0,
      subscriptions: {
        setup() {},
      },
    };

    app.model(model);
    app.start();
    expect(() => {
      app.model(model);
    }).toThrow(/\[app\.model\] namespace should be unique/);
  });

  it('unmodel', () => {
    const emitter = new EventEmitter();
    let emitterCount = 0;

    const app = create();
    app.model({
      namespace: 'a',
      state: 0,
      reducers: {
        add(state) { return state + 1; },
      },
    });
    app.model({
      namespace: 'b',
      state: 0,
      reducers: {
        add(state) { return state + 1; },
      },
      effects: {
        *addBoth(action, { put }) {
          yield put({ type: 'a/add' });
          yield put({ type: 'add' });
        },
      },
      subscriptions: {
        setup() {
          emitter.on('event', () => { emitterCount += 1; });
          return () => {
            emitter.removeAllListeners();
          };
        },
      },
    });
    app.start();

    emitter.emit('event');
    app.unmodel('b');
    emitter.emit('event');

    app._store.dispatch({ type: 'b/addBoth' });

    const { a, b } = app._store.getState();
    expect(emitterCount).toEqual(1);
    expect({ a, b }).toEqual({ a: 0, b: undefined });
  });

  it('unmodel with asyncReducers', () => {
    const app = create();
    app.model({
      namespace: 'a',
      state: 0,
      reducers: {
        add(state) { return state + 1; },
      },
    });
    app.start();

    app.model({
      namespace: 'b',
      state: 0,
      reducers: {
        add(state) { return state + 1; },
      },
      effects: {
        *addBoth(action, { put }) {
          yield put({ type: 'a/add' });
          yield put({ type: 'add' });
        },
      },
    });

    app._store.dispatch({ type: 'b/addBoth' });
    app.unmodel('b');
    app._store.dispatch({ type: 'b/addBoth' });
    const { a, b } = app._store.getState();
    expect({ a, b }).toEqual({ a: 1, b: undefined });
  });

  it('unmodel, warn user if subscription don\'t return function', () => {
    const app = create();
    app.model({
      namespace: 'a',
      state: 0,
      subscriptions: {
        a() {},
      },
    });
    app.start();
    app.unmodel('a');
  });

  it('unmodel with other type of effects', () => {
    const app = create();
    let countA = 0;
    let countB = 0;
    let countC = 0;
    let countD = 0;

    app.model({
      namespace: 'a',
      state: 0,
      effects: {
        a: [function*() { countA += 1; }, { type: 'throttle', ms: 100 }],
        b: [function*() { countB += 1; }, { type: 'takeEvery' }],
        c: [function*() { countC += 1; }, { type: 'takeLatest' }],
        d: [function*({ take }) {
          while (true) {
            yield take('a/d');
            countD += 1;
          }
        }, { type: 'watcher' }],
      },
    });

    app.start();

    app._store.dispatch({ type: 'a/a' });
    app._store.dispatch({ type: 'a/b' });
    app._store.dispatch({ type: 'a/c' });
    app._store.dispatch({ type: 'a/d' });

    expect([countA, countB, countC, countD]).toEqual([1, 1, 1, 1]);

    app.unmodel('a');

    app._store.dispatch({ type: 'a/b' });
    app._store.dispatch({ type: 'a/c' });
    app._store.dispatch({ type: 'a/d' });

    expect([countA, countB, countC, countD]).toEqual([1, 1, 1, 1]);
  });
});
