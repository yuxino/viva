import { createStore, applyMiddleware } from 'redux';
import createSagaMiddleware from 'redux-saga';
import createRootReducer from '../reducers';
import sagas from '../sagas';

const rootReducer = createRootReducer();
const sagaMiddleware = createSagaMiddleware();

function configureStore(initialState?: any) {
  const store = createStore(
    rootReducer,
    initialState,
    applyMiddleware(sagaMiddleware)
  );
  sagaMiddleware.run(sagas);
  return store;
}

export default { configureStore, history };
