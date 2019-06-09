import { combineReducers } from 'redux';
import explore from './explore';
import tabs from './tabs';
import titlebar from './titlebar';
import view from './view';

export default function createRootReducer() {
  return combineReducers({
    explore,
    tabs,
    titlebar,
    view
  });
}
