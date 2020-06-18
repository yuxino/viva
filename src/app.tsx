import * as React from "react";
import { render } from "react-dom";
import { StoreContext } from "redux-react-hook";
import { store } from "./store/configureStore";
import App from "./containers/App";
import "./styles/index.css";
import "@viva-ui/theme/dist/index.css";

render(
  <StoreContext.Provider value={store}>
    <App />
  </StoreContext.Provider>,
  document.getElementById("app")
);
