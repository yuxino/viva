import { combineReducers } from 'redux';
import explore from './explore';
import tab from './tab';
import titlebar from './titlebar';
import view from './view';

export default function createRootReducer() {
  return combineReducers({
    explore,
    tab,
    titlebar,
    view
  });
}
