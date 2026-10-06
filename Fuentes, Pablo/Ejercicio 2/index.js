import express from 'express'
import mysql from 'mysql2/promise'
import { body, param, query, validationResult } from 'express-validator'

const app = express()
let db = null

const crearConexion = async () => {
  try {
    db = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_DATABASE,
    })

    console.log('Conexión a la base de datos establecida')
  } catch (error) {
    console.error('No se pudo conectar con MySQL:', error.message)
    process.exit(1)
  }
}

app.use(express.json())

const mensajeNombreRepetido = 'Ya existe una tarea con ese nombre'

const validarConsulta = [
  query().custom((value) => Object.keys(value).every((campo) => campo === 'estado'))
    .withMessage('Solo se admite el parámetro estado'),
  query('estado')
    .optional()
    .isIn(['completadas', 'pendientes'])
    .withMessage('El estado debe ser completadas o pendientes')
]

const validarId = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('El id debe ser un entero positivo')
    .toInt()
]

const validarAlta = [
  body().custom((value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('El cuerpo debe ser un objeto JSON válido')
    }

    if (Object.keys(value).some((campo) => !['nombre', 'estado'].includes(campo))) {
      throw new Error('Solo se permiten los campos nombre y estado')
    }

    return true
  }),
  body('nombre')
    .exists()
    .withMessage('El nombre es obligatorio')
    .bail()
    .isString()
    .withMessage('El nombre debe ser texto')
    .bail()
    .trim()
    .notEmpty()
    .withMessage('El nombre no puede quedar vacío')
    .isLength({ max: 100 })
    .withMessage('El nombre no puede superar los 100 caracteres')
    .bail()
    .custom(async (nombre) => {
      const [coincidencias] = await db.execute(
        'SELECT id FROM tareas WHERE nombre = ? LIMIT 1',
        [nombre]
      )

      if (coincidencias.length > 0) {
        throw new Error(mensajeNombreRepetido)
      }

      return true
    }),
  body('estado')
    .custom((value) => typeof value === 'boolean')
    .withMessage('El estado debe ser un booleano true o false')
]

const validarCambio = [
  body().custom((value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('El cuerpo debe ser un objeto JSON válido')
    }

    if (Object.keys(value).some((campo) => campo !== 'estado')) {
      throw new Error('Solo se permite el campo estado')
    }

    return true
  }),
  body('estado')
    .custom((value) => typeof value === 'boolean')
    .withMessage('El estado debe ser un booleano true o false')
]

const manejarErrores = (req, res, next) => {
  const errores = validationResult(req)

  if (!errores.isEmpty()) {
    const detalles = errores.array().map(({ path, msg }) => ({ campo: path, mensaje: msg }))
    const codigo = detalles.some(({ mensaje }) => mensaje === mensajeNombreRepetido) ? 409 : 400

    return res.status(codigo).json({
      error: codigo === 409 ? mensajeNombreRepetido : 'Solicitud inválida',
      detalles,
    })
  }

  next()
}

const serializarTarea = (fila) => ({
  id: fila.id,
  nombre: fila.nombre,
  estado: Boolean(fila.estado),
})

app.use(validarConsulta, manejarErrores)

app.get('/tareas', async (req, res) => {
  let sql = 'SELECT id, nombre, estado FROM tareas'
  const params = []

  if (req.query.estado === 'completadas') {
    sql += ' WHERE estado = ?'
    params.push(true)
  } else if (req.query.estado === 'pendientes') {
    sql += ' WHERE estado = ?'
    params.push(false)
  }

  sql += ' ORDER BY id'

  const [filas] = await db.execute(sql, params)
  res.json(filas.map(serializarTarea))
})

app.get('/tareas/:id', validarId, manejarErrores, async (req, res) => {
  const [filas] = await db.execute(
    'SELECT id, nombre, estado FROM tareas WHERE id = ?',
    [req.params.id]
  )

  if (filas.length === 0) {
    return res.status(404).json({ error: 'Tarea no encontrada' })
  }

  res.json(serializarTarea(filas[0]))
})

app.post('/tareas', validarAlta, manejarErrores, async (req, res) => {
  const { nombre, estado } = req.body

  try {
    const [resultado] = await db.execute(
      'INSERT INTO tareas (nombre, estado) VALUES (?, ?)',
      [nombre, estado]
    )

    return res.location(`/tareas/${resultado.insertId}`).status(201).json({
      id: resultado.insertId,
      nombre,
      estado,
    })
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: mensajeNombreRepetido })
    }

    throw error
  }
})

app.patch('/tareas/:id', validarId, validarCambio, manejarErrores, async (req, res) => {
  const [resultado] = await db.execute(
    'UPDATE tareas SET estado = ? WHERE id = ?',
    [req.body.estado, req.params.id]
  )

  if (resultado.affectedRows === 0) {
    const [existentes] = await db.execute(
      'SELECT id FROM tareas WHERE id = ?',
      [req.params.id]
    )

    if (existentes.length === 0) {
      return res.status(404).json({ error: 'Tarea no encontrada' })
    }
  }

  const [filas] = await db.execute(
    'SELECT id, nombre, estado FROM tareas WHERE id = ?',
    [req.params.id]
  )

  res.json(serializarTarea(filas[0]))
})

app.delete('/tareas/:id', validarId, manejarErrores, async (req, res) => {
  const [resultado] = await db.execute(
    'DELETE FROM tareas WHERE id = ?',
    [req.params.id]
  )

  if (resultado.affectedRows === 0) {
    return res.status(404).json({ error: 'Tarea no encontrada' })
  }

  res.status(204).end()
})

app.use((error, req, res, next) => {
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'El cuerpo debe contener JSON válido' })
  }

  console.error('Error inesperado:', error)
  res.status(500).json({ error: 'Error interno del servidor' })
})

const arrancarServidor = async () => {
  await crearConexion()
  await db.query('SELECT 1')

  app.listen(3000, () => {
    console.log('API en funcionamiento en el puerto 3000')
  })
}

arrancarServidor().catch((error) => {
  console.error('La API no pudo inicializarse:', error)
  process.exitCode = 1
})
