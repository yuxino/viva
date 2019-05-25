import { combineReducers } from 'redux';
import editor from './editor';

export default function createRootReducer() {
  return combineReducers({
    editor
  });
}
