[![CircleCI](https://circleci.com/gh/DAB0mB/babel-plugin-react-persist/tree/master.svg?style=svg)](https://circleci.com/gh/DAB0mB/babel-plugin-react-persist/tree/master)

# babel-plugin-react-persist

A Babel plug-in that optimizes your React.Component's implementation by automatically detecting declarations that should persist between rendering phases and replacing them with `useCallback()` and `useMemo()` whenever necessary. This plug-in can also be used to solve excessive processing power caused by using anonymous callbacks provided to JSX element by making them non-anonymous. **Note that this plug-in is experimental and shouldn't be used in production yet**. Compatible with React 16.8-alpha and above (hooks support).

### Example

#### in

```jsx
export default ({ data, sortComparator, filterPredicate, history }) => {
  const transformedData = data.filter(filterPredicate).sort(sortComparator)

  return (
    <div>
      <button className="back-btn" onClick={() => history.pop()} />
      <ul className="data-list">
        {transformedData.map(({ id, value }) => (
          <li className="data-item" key={id} onClick={() => history.push(`data/${id}`)}>{value}</li>
        ))}
      </ul>
    </div>
  )
}
```

#### out

```jsx
let _anonymousFnComponent, _anonymousFnComponent2

export default ({ data, sortComparator, filterPredicate, history }) => {
  const transformedData = React.useMemo(() =>
    data.filter(filterPredicate).sort(sortComparator)
  , [data, data.filter, filterPredicate, sortComparator])

  return React.createElement(_anonymousFnComponent2 = _anonymousFnComponent2 || (() => {
    const _onClick2 = React.useCallback(() => history.pop(), [history, history.pop])

    return (
      <div>
        <button className="back-btn" onClick={_onClick2} />
        <ul className="data-list">
          {transformedData.map(({ id, value }) =>
            React.createElement(_anonymousFnComponent = _anonymousFnComponent || (() => {
              const _onClick = React.useCallback(() =>
                history.push(`data/${id}`)
              , [history, history.push, id])

              return (
                <li className="data-item" key={id} onClick={_onClick}>
                  {value}
                </li>
              )
            }), { key: id })
          )}
        </ul>
      </div>
    )
  }), null)
}
```

### Usage

`babel-plugin-react-persist` is installable via NPM (or Yarn):

    $ npm install babel-plugin-react-persist

Add to `.babelrc` under `plugins` and be sure to load it **before** any JSX transformation related plug-ins.

```json
{
  "presets": ["@babel/preset-react"],
  "plugins": ["babel-plugin-react-persist"]
}
```

### License

MIT. If you're including this in a repo above 1k stars I would really appreciate it if you could contact me first.
