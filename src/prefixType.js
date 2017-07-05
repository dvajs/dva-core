import { NAMESPACE_SEP } from './constants';

export default function prefixType(type, model) {
  const prefixedType = `${model.namespace}${NAMESPACE_SEP}${type}`;
  if ((model.reducers && model.reducers[prefixedType])
    || (model.effects && model.effects[prefixedType])) {
    return prefixedType;
  }
  return type;
}
