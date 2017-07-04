import expect from 'expect';
import { create } from '../src/index';

describe('reducers', () => {
  it('type error', () => {
    const app = create();
    expect(() => {
      app.model({
        namespace: '_array',
        reducers: [{}, () => {}],
      });
    }).toNotThrow();
    expect(() => {
      app.model({
        namespace: '_object',
        reducers: {},
      });
    }).toNotThrow();
    expect(() => {
      app.model({
        namespace: '_neither',
        reducers: '_',
      });
    }).toThrow(/\[app\.model\] reducers should be undefined, plain object or array/);
    expect(() => {
      app.model({
        namespace: '_none',
        reducers: [],
      });
    }).toThrow(/\[app\.model\] reducers with array should be \[Object, Function\]/);
  });

  it('enhancer', () => {
    function enhancer(reducer) {
      return (state, action) => {
        if (action.type === 'square') {
          return state * state;
        }
        return reducer(state, action);
      };
    }

    const app = create();
    app.model({
      namespace: 'count',
      state: 3,
      reducers: [{
        add(state, { payload }) { return state + (payload || 1); },
      }, enhancer],
    });
    app.start();

    app._store.dispatch({ type: 'square' });
    app._store.dispatch({ type: 'count/add' });
    expect(app._store.getState().count).toEqual(10);
  });

  it('extraReducers', () => {
    const reducers = {
      count: (state, { type }) => {
        if (type === 'add') {
          return state + 1;
        }
        // default state
        return 0;
      },
    };
    const app = create({
      extraReducers: reducers,
    });
    app.start();

    expect(app._store.getState().count).toEqual(0);
    app._store.dispatch({ type: 'add' });
    expect(app._store.getState().count).toEqual(1);
  });

  // core 没有 routing 这个 reducer，所以用例无效了
  xit('extraReducers: throw error if conflicts', () => {
    const app = create({
      extraReducers: { routing() {} },
    });
    expect(() => {
      app.start();
    }).toThrow(/\[app\.start\] extraReducers is conflict with other reducers/);
  });

  it('onReducer', () => {
    const undo = r => (state, action) => {
      const newState = r(state, action);
      return { present: newState, routing: newState.routing };
    };
    const app = create({
      onReducer: undo,
    });
    app.model({
      namespace: 'count',
      state: 0,
      reducers: {
        update(state) { return state + 1; },
      },
    });
    app.start();

    expect(app._store.getState().present.count).toEqual(0);
  });
});
