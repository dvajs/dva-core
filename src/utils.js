
export isPlainObject from 'is-plain-object';
export const isArray = Array.isArray.bind(Array);
export const isFunction = o => typeof o === 'function';

export function returnSelf(m) {
  return m;
}
