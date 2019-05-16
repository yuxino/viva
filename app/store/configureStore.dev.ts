import { createStore, applyMiddleware, compose } from 'redux';
import { createLogger } from 'redux-logger';
import createSagaMiddleware from 'redux-saga';
import createRootReducer from '../reducers';
import sagas from '../sagas';

const rootReducer = createRootReducer();
const sagaMiddleware = createSagaMiddleware();

const configureStore = (initialState?: any) => {
  // Redux Configuration
  const middleware = [];
  const enhancers = [];

  // Logging Middleware
  const logger = createLogger({
    level: 'info',
    collapsed: true
  });

  // Skip redux logs in console during the tests
  if (process.env.NODE_ENV !== 'test') {
    middleware.push(logger);
  }

  middleware.push(sagaMiddleware);

  // Redux DevTools Configuration
  const actionCreators = {};

  // If Redux DevTools Extension is installed use it, otherwise use Redux compose
  /* eslint-disable no-underscore-dangle */
  const composeEnhancers = (window as any).__REDUX_DEVTOOLS_EXTENSION_COMPOSE__
    ? (window as any).__REDUX_DEVTOOLS_EXTENSION_COMPOSE__({
        // Options: http://extension.remotedev.io/docs/API/Arguments.html
        actionCreators
      })
    : compose;
  /* eslint-enable no-underscore-dangle */

  // Apply Middleware & Compose Enhancers
  enhancers.push(applyMiddleware(...middleware));
  const enhancer = composeEnhancers(...enhancers);

  // Create Store
  const store = createStore(rootReducer, initialState, enhancer);

  if ((module as any).hot) {
    (module as any).hot.accept(
      '../reducers', // eslint-disable-next-line global-require
      () => store.replaceReducer(require('../reducers').default)
    );
  }

  sagaMiddleware.run(sagas);

  return store;
};

export default { configureStore, history };
