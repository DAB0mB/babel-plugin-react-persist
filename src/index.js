import generate from '@babel/generator'

export default ({ types: t, parse: babelParse }) => {
  let parseOptions

  // Original parse + provided options
  const parse = (code) => {
    return babelParse(code, parseOptions)
  }

  const getAllOwnBindings = (scope) => {
    const allBindings = scope.getAllBindings()

    return Object.keys(allBindings).reduce((ownBindings, bindingName) => {
      const binding = allBindings[bindingName]

      if (scope.hasOwnBinding(bindingName)) {
        ownBindings[bindingName] = binding
      }

      return ownBindings
    }, {})
  }

  // Return a unique list
  const getAllIdentifierNames = (parentPath) => {
    const identifiers = []

    parentPath.traverse({
      Identifier(path) {
        if (
          !identifiers.includes(path.node.name) &&
          parentPath.scope.hasBinding(path.node.name)
        ) {
          identifiers.push(path.node.name)
        }
      },
    })

    return identifiers
  }

  // Arrow function or regular function
  const isAnyFunctionExpression = (node) => {
    return node && (
      t.isArrowFunctionExpression(node) ||
      t.isFunctionExpression(node)
    )
  }

  // If expression ends up with a useXXX()
  const isReactHook = (node) => {
    return /^use/.test(node.name) || /^use/.test(node.property.name)
  }

  // Example output: const foo = useCallback(() => alert(text), [text])
  const generateCallback = (callbackName, callbackBody) => {
    const identifiers = getAllIdentifierNames(callbackBody)
    callbackBody = generate(callbackBody.node).code

    return parse(`
      const ${callbackName} = React.useCallback(${callbackBody}, [${identifiers}])
    `).program.body[0]
  }

  // Example output: const foo = useMemo(() => bar, [bar])
  const generateMemo = (memoName, memoBody) => {
    const identifiers = getAllIdentifierNames(memoBody)
    memoBody = generate(memoBody.node).code

    return parse(`
      const ${memoName} = React.useMemo(() => ${memoBody}, [${identifiers}])
    `).program.body[0]
  }

  return {
    pre({ opts }) {
      // Store original parse options
      parseOptions = opts
    },

    visitor: {
      // Add scope to arrow functions and JSX blocks e.g.
      // () => <el /> will become () => { return <el /> }
      // {<el />} will become {(() => <el />)()}
      // this way we can use nested hooks
      JSXElement(path) {
        let returnValue = path
        let container = path.parentPath
        while (
          t.isJSXElement(container.node) ||
          t.isConditionalExpression(container.node) ||
          t.isLogicalExpression(container.node)
        ) {
          returnValue = returnValue.parentPath
          container = container.parentPath
        }

        if (!container) return

        let scopedReturnValue
        if (t.isArrowFunctionExpression(container.node)) {
          scopedReturnValue = parse(`
            () => {
              return ${generate(returnValue.node).code}
            }
          `).program.body[0].expression.body
        }
        else if (t.isJSXExpressionContainer(container.node)) {
          scopedReturnValue = parse(`
            (() => {
              return ${generate(returnValue.node).code}
            })()
          `).program.body[0]
        }

        if (scopedReturnValue) {
          returnValue.replaceWith(scopedReturnValue)
        }
      },

      // Add useCallback() for all inline functions
      JSXAttribute(path) {
        if (!t.isJSXExpressionContainer(path.node.value)) return
        if (!isAnyFunctionExpression(path.node.value.expression)) return

        let returnStatement = path
        while (returnStatement && !t.isReturnStatement(returnStatement)) {
          returnStatement = returnStatement.parentPath

          if (t.isJSXExpressionContainer(returnStatement)) return
        }

        if (!returnStatement) return
        if (!isAnyFunctionExpression(returnStatement.parentPath.parentPath.node)) return

        const callbackName = path.scope.generateUidIdentifier(path.node.name.name).name
        const callbackBody = path.get('value.expression')
        const callback = generateCallback(callbackName, callbackBody)

        callbackBody.replaceWithSourceString(callbackName)
        returnStatement.insertBefore(callback)
      },

      // For all *final* return statements, go through all const declarations
      // and replace them with useCallback() or useMemo()
      ReturnStatement(path) {
        if (!t.isJSXElement(path.node.argument)) return

        const ownBindings = getAllOwnBindings(path.scope)

        Object.keys(ownBindings).forEach((bindingName) => {
          const binding = ownBindings[bindingName]

          if (!binding.constant) return
          if (!t.isVariableDeclarator(binding.path.node)) return
          if (
            t.isCallExpression(binding.path.node.init) &&
            isReactHook(binding.path.node.init.callee)
          ) {
            return
          }

          const generateReplacement = isAnyFunctionExpression(binding.path.node.init)
            ? generateCallback
            : generateMemo
          const wrappedAssignment = generateReplacement(
            bindingName,
            binding.path.get('init')
          )

          binding.path.parentPath.replaceWith(wrappedAssignment)
        })
      },
    },
  }
}
