import { createStore, applyMiddleware, compose, combineReducers } from 'redux';
import createSagaMiddleware from 'redux-saga/lib/internal/middleware';
import * as sagaEffects from 'redux-saga/effects';
import {
  takeEveryHelper as takeEvery,
  takeLatestHelper as takeLatest,
  throttleHelper as throttle,
} from 'redux-saga/lib/internal/sagaHelpers';
import invariant from 'invariant';
import warning from 'warning';
import flatten from 'flatten';
import window from 'global/window';
import checkModel from './checkModel';
import prefixNamespace from './prefixNamespace';
import handleActions from './handleActions';
import { isArray, isFunction, returnSelf } from './utils';
import { NAMESPACE_SEP } from './constants';
import Plugin from './Plugin';

export function create(hooksAndOpts = {}, createOpts = {}) {
  const {
    initialReducer,
    setupMiddlewares = returnSelf,
  } = createOpts;

  // initialState 不传给 Plugin
  const initialState = hooksAndOpts.initialState || {};
  delete hooksAndOpts.initialState;

  const plugin = new Plugin();
  plugin.use(hooksAndOpts);

  const app = {
    // Properties
    _models: [],
    _store: null,
    _plugin: plugin,

    // Methods
    use: plugin.use.bind(plugin),
    model,
    start,
  };

  return app;

  //////////////////////////////////////
  // Methods

  function model(m) {
    checkModel(m, app._models);
    app._models.push(prefixNamespace(m));
  }

  function injectModel(createReducer, onError, unlisteners, m) {
    model(m);

    const store = app._store;

    // reducers
    store.asyncReducers[m.namespace] = getReducer(m.reducers, m.state);
    store.replaceReducer(createReducer(store.asyncReducers));

    // effects
    if (m.effects) {
      store.runSaga(getSaga(m.effects, m, onError));
    }

    // subscriptions
    if (m.subscriptions) {
      unlisteners[m.namespace] = runSubscriptions(m.subscriptions, m, this, onError);
    }
  }

  // Unexpected key warn problem:
  // https://github.com/reactjs/redux/issues/1636
  function unmodel(createReducer, reducers, _unlisteners, namespace) {
    const store = app._store;

    // Delete reducers
    delete store.asyncReducers[namespace];
    delete reducers[namespace];
    store.replaceReducer(createReducer());
    store.dispatch({ type: '@@dva/UPDATE' });

    // Cancel effects
    store.dispatch({ type: `${namespace}/@@CANCEL_EFFECTS` });

    // unlisten subscrioptions
    if (_unlisteners[namespace]) {
      const { unlisteners, noneFunctionSubscriptions } = _unlisteners[namespace];
      warning(
        noneFunctionSubscriptions.length === 0,
        `[app.unmodel] subscription should return unlistener function, check these subscriptions ${noneFunctionSubscriptions.join(', ')}`,
      );
      for (const unlistener of unlisteners) {
        unlistener();
      }
      delete _unlisteners[namespace];
    }

    // delete model from this._models
    this._models = this._models.filter(model => model.namespace !== namespace);
  }

  function start() {
    // error wrapper
    const onError = plugin.apply('onError', (err) => {
      // TODO: 默认的 onError 不应该 throw
      throw new Error(err.stack || err);
    });
    const onErrorWrapper = (err) => {
      if (err) {
        if (typeof err === 'string') err = new Error(err);
        onError(err, app._store.dispatch);
      }
    };

    // internal model for destroy
    model({
      namespace: '@@dva',
      state: 0,
      reducers: {
        UPDATE(state) { return state + 1; },
      },
    });

    // 提取 sagas 和 reducers
    const sagas = [];
    const reducers = { ...initialReducer };
    for (const m of app._models) {
      reducers[m.namespace] = getReducer(m.reducers, m.state);
      if (m.effects) sagas.push(getSaga(m.effects, m, onErrorWrapper));
    }

    // extra reducers
    const extraReducers = plugin.get('extraReducers');
    invariant(
      Object.keys(extraReducers).every(key => !(key in reducers)),
      `[app.start] extraReducers is conflict with other reducers, reducers list: ${Object.keys(reducers).join(', ')}`,
    );

    // extra enhancers
    const extraEnhancers = plugin.get('extraEnhancers');
    invariant(
      isArray(extraEnhancers),
      `[app.start] extraEnhancers should be array, but got ${typeof extraEnhancers}`,
    );

    // create store
    const extraMiddlewares = plugin.get('onAction');
    const reducerEnhancer = plugin.get('onReducer');
    const sagaMiddleware = createSagaMiddleware();
    // TODO: 在 setupMiddlewares 里处理 routerMiddleware
    const middlewares = setupMiddlewares([
      sagaMiddleware,
      ...flatten(extraMiddlewares),
    ]);
    let devtools = () => noop => noop;
    if (process.env.NODE_ENV !== 'production' && window.__REDUX_DEVTOOLS_EXTENSION__) {
      devtools = window.__REDUX_DEVTOOLS_EXTENSION__;
    }
    const enhancers = [
      applyMiddleware(...middlewares),
      devtools(),
      ...extraEnhancers,
    ];
    const store = app._store = createStore(  // eslint-disable-line
      createReducer(),
      initialState,
      compose(...enhancers),
    );

    // extend store
    store.runSaga = sagaMiddleware.run;
    store.asyncReducers = {};

    // store change
    const listeners = plugin.get('onStateChange');
    for (const listener of listeners) {
      store.subscribe(() => {
        listener(store.getState());
      });
    }

    // start saga
    sagas.forEach(sagaMiddleware.run);

    // TODO: setupHistory

    // run subscriptions
    const unlisteners = {};
    for (const model of this._models) {
      if (model.subscriptions) {
        unlisteners[model.namespace] = runSubscriptions(model.subscriptions, model, this,
          onErrorWrapper);
      }
    }

    // 绑定 app.start 内部变量
    app.model = injectModel.bind(app, createReducer, onErrorWrapper, unlisteners);
    app.unmodel = unmodel.bind(app, createReducer, reducers, unlisteners);

    ///////////////////////
    // app.start helpers

    function createReducer() {
      return reducerEnhancer(combineReducers({
        ...reducers,
        ...extraReducers,
        ...(app._store ? app._store.asyncReducers : {}),
      }));
    }
  }

  //////////////////////////////////////
  // Helpers

  function getReducer(reducers, state) {
    // Support reducer enhancer
    // e.g. reducers: [realReducers, enhancer]
    if (Array.isArray(reducers)) {
      return reducers[1](handleActions(reducers[0], state));
    } else {
      return handleActions(reducers || {}, state);
    }
  }

  function getSaga(effects, model, onError) {
    return function *() {
      for (const key in effects) {
        if (Object.prototype.hasOwnProperty.call(effects, key)) {
          const watcher = getWatcher(key, effects[key], model, onError);
          const task = yield sagaEffects.fork(watcher);
          yield sagaEffects.fork(function *() {
            yield sagaEffects.take(`${model.namespace}/@@CANCEL_EFFECTS`);
            yield sagaEffects.cancel(task);
          });
        }
      }
    };
  }

  function getWatcher(key, _effect, model, onError) {
    let effect = _effect;
    let type = 'takeEvery';
    let ms;

    if (Array.isArray(_effect)) {
      effect = _effect[0];
      const opts = _effect[1];
      if (opts && opts.type) {
        type = opts.type;
        if (type === 'throttle') {
          invariant(
            opts.ms,
            'app.start: opts.ms should be defined if type is throttle',
          );
          ms = opts.ms;
        }
      }
      invariant(
        ['watcher', 'takeEvery', 'takeLatest', 'throttle'].indexOf(type) > -1,
        'app.start: effect type should be takeEvery, takeLatest, throttle or watcher',
      );
    }

    function *sagaWithCatch(...args) {
      try {
        yield effect(...args.concat(createEffects(model)));
      } catch (e) {
        onError(e);
      }
    }

    const onEffect = plugin.get('onEffect');
    const sagaWithOnEffect = applyOnEffect(onEffect, sagaWithCatch, model, key);

    switch (type) {
      case 'watcher':
        return sagaWithCatch;
      case 'takeLatest':
        return function*() {
          yield takeLatest(key, sagaWithOnEffect);
        };
      case 'throttle':
        return function*() {
          yield throttle(ms, key, sagaWithOnEffect);
        };
      default:
        return function*() {
          yield takeEvery(key, sagaWithOnEffect);
        };
    }
  }

  function runSubscriptions(subs, model, app, onError) {
    const unlisteners = [];
    const noneFunctionSubscriptions = [];
    for (const key in subs) {
      if (Object.prototype.hasOwnProperty.call(subs, key)) {
        const sub = subs[key];
        invariant(typeof sub === 'function', 'app.start: subscription should be function');
        const unlistener = sub({
          dispatch: createDispatch(app._store.dispatch, model),
          history: app._history,
        }, onError);
        if (isFunction(unlistener)) {
          unlisteners.push(unlistener);
        } else {
          noneFunctionSubscriptions.push(key);
        }
      }
    }
    return { unlisteners, noneFunctionSubscriptions };
  }

  function prefixType(type, model) {
    const prefixedType = `${model.namespace}${NAMESPACE_SEP}${type}`;
    if ((model.reducers && model.reducers[prefixedType])
      || (model.effects && model.effects[prefixedType])) {
      return prefixedType;
    }
    return type;
  }

  function createEffects(model) {
    function put(action) {
      const { type } = action;
      invariant(type, 'dispatch: action should be a plain Object with type');
      warning(
        type.indexOf(`${model.namespace}${NAMESPACE_SEP}`) !== 0,
        `effects.put: ${type} should not be prefixed with namespace ${model.namespace}`,
      );
      return sagaEffects.put({ ...action, type: prefixType(type, model) });
    }
    return { ...sagaEffects, put };
  }

  function createDispatch(dispatch, model) {
    return (action) => {
      const { type } = action;
      invariant(type, 'dispatch: action should be a plain Object with type');
      warning(
        type.indexOf(`${model.namespace}${NAMESPACE_SEP}`) !== 0,
        `dispatch: ${type} should not be prefixed with namespace ${model.namespace}`,
      );
      return dispatch({ ...action, type: prefixType(type, model) });
    };
  }

  function applyOnEffect(fns, effect, model, key) {
    for (const fn of fns) {
      effect = fn(effect, sagaEffects, model, key);
    }
    return effect;
  }
}
