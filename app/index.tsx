import * as React from 'react';
import { render } from 'react-dom';
import { StoreContext } from 'redux-react-hook';
import { AppContainer } from 'react-hot-loader';
import { configureStore } from './store/configureStore';
import App from './containers/App';
import './styles/index.scss';

const store = configureStore();

render(
  <AppContainer>
    <StoreContext.Provider value={store}>
      <App />
    </StoreContext.Provider>
  </AppContainer>,
  document.getElementById('root')
);

if ((module as any).hot) {
  (module as any).hot.accept('./containers/App', () => {
    // eslint-disable-next-line global-require
    // const NextRoot = require('./containers/Root').default;
    render(
      <AppContainer>
        <StoreContext.Provider value={store}>
          <App />
        </StoreContext.Provider>
      </AppContainer>,
      document.getElementById('root')
    );
  });
}
