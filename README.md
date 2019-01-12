[![CircleCI](https://circleci.com/gh/DAB0mB/babel-plugin-react-persist/tree/master.svg?style=svg)](https://circleci.com/gh/DAB0mB/babel-plugin-react-persist/tree/master)

# babel-plugin-react-persist

A Babel plug-in that optimizes your React components' implementation by automatically detecting declarations that should persist between rendering phases and replacing them with `useCallback()` and `useMemo()` whenever necessary. This plug-in can also be used with inline anonymous functions in JSX attributes and solve excessive processing power issues. **Note that this plug-in is experimental and shouldn't be used in production yet**. Compatible with React 16.7 and above (hooks support).

### Example

#### in

```jsx
export default ({
  data,
  sortComparator,
  filterPredicate,
  history,
}) => {
  const transformedData = data
    .filter(filterPredicate)
    .sort(sortComparator)

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
export default (({
  data,
  sortComparator,
  filterPredicate,
  history,
}) => {
  const transformedData = React.useMemo(() =>
    data
      .filter(filterPredicate)
      .sort(sortComparator)
  , [data, filterPredicate, sortComparator])

  const _onClick = React.useCallback(() =>
    history.pop()
  , [history])

  return (
    <div>
      <button className="back-btn" onClick={_onClick} />
      <ul className="data-list">
        {transformedData.map(({ id, value }) => {
          const _onClick2 = React.useCallback(() =>
            history.push(`data/${id}`)
          , [history, id])

          return (
            <li className="data-item" key={id} onClick={_onClick2}>{value}</li>
          )
        })}
      </ul>
    </div>
  )
})
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
