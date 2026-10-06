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

    console.log('Conexión a la base de datos activa')
  } catch (error) {
    console.error('No se pudo conectar con MySQL:', error.message)
    process.exit(1)
  }
}

app.use(express.json())

const mensajeCalificacionDuplicada = 'Ya existe una calificación para ese alumno y materia'
const mensajeMateriaDuplicada = 'Ya existe una materia con ese nombre'
const mensajeMateriaEnUso = 'No se puede borrar una materia con calificaciones asociadas'

const validarId = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('El id debe ser un entero positivo')
    .toInt()
]

const sinParametrosQuery = [
  query().custom((value) => Object.keys(value).length === 0)
    .withMessage('Este recurso no acepta parámetros de consulta')
]

const validarConsultaCalificaciones = [
  query().custom((value) =>
    Object.keys(value).every((campo) => ['alumno', 'materiaId'].includes(campo))
  ).withMessage('Solo se permiten los filtros alumno y materiaId'),
  query('alumno')
    .optional()
    .isString()
    .withMessage('El nombre del alumno debe ser texto')
    .bail()
    .trim()
    .notEmpty()
    .withMessage('El nombre del alumno no puede quedar vacío')
    .isLength({ max: 100 })
    .withMessage('El nombre del alumno no puede superar los 100 caracteres'),
  query('materiaId')
    .optional()
    .isInt({ min: 1 })
    .withMessage('materiaId debe ser un entero positivo')
    .toInt()
]

const validarMateria = [
  body().custom((value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('El cuerpo debe ser un objeto JSON válido')
    }

    if (Object.keys(value).some((campo) => campo !== 'nombre')) {
      throw new Error('Solo se permite el campo nombre')
    }

    return true
  }),
  body('nombre')
    .exists()
    .withMessage('El nombre de la materia es obligatorio')
    .bail()
    .isString()
    .withMessage('El nombre de la materia debe ser texto')
    .bail()
    .trim()
    .notEmpty()
    .withMessage('El nombre de la materia no puede quedar vacío')
    .isLength({ max: 100 })
    .withMessage('El nombre de la materia no puede superar los 100 caracteres')
]

const validarCalificacion = (ignorarId = false) => [
  body().custom((value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('El cuerpo debe ser un objeto JSON válido')
    }

    if (Object.keys(value).some((campo) => !['alumno', 'materiaId', 'notas'].includes(campo))) {
      throw new Error('Solo se permiten los campos alumno, materiaId y notas')
    }

    return true
  }),
  body('alumno')
    .exists()
    .withMessage('El nombre del alumno es obligatorio')
    .bail()
    .isString()
    .withMessage('El nombre del alumno debe ser texto')
    .bail()
    .trim()
    .notEmpty()
    .withMessage('El nombre del alumno no puede quedar vacío')
    .isLength({ max: 100 })
    .withMessage('El nombre del alumno no puede superar los 100 caracteres'),
  body('materiaId')
    .exists()
    .withMessage('materiaId es obligatorio')
    .bail()
    .isInt({ min: 1 })
    .withMessage('materiaId debe ser un entero positivo')
    .toInt()
    .bail()
    .custom(async (materiaId) => {
      const [materias] = await db.execute(
        'SELECT id FROM materias WHERE id = ?',
        [materiaId]
      )

      if (materias.length === 0) {
        throw new Error('La materia indicada no existe')
      }

      return true
    }),
  body('notas')
    .isArray({ min: 3, max: 3 })
    .withMessage('Se deben informar exactamente tres notas'),
  body('notas.*')
    .custom((nota) => typeof nota === 'number' && Number.isFinite(nota) && nota >= 0 && nota <= 10)
    .withMessage('Cada nota debe ser un número entre 0 y 10'),
  body('alumno').custom(async (alumno, { req }) => {
    const { materiaId } = req.body

    if (typeof alumno !== 'string' || typeof materiaId === 'undefined') {
      return true
    }

    const parametros = [alumno, materiaId]
    let sql = 'SELECT id FROM calificaciones WHERE alumno = ? AND materia_id = ?'

    if (ignorarId) {
      sql += ' AND id <> ?'
      parametros.push(req.params.id)
    }

    sql += ' LIMIT 1'

    const [calificaciones] = await db.execute(sql, parametros)

    if (calificaciones.length > 0) {
      throw new Error(mensajeCalificacionDuplicada)
    }

    return true
  })
]

const manejarErrores = (req, res, next) => {
  const errores = validationResult(req)

  if (!errores.isEmpty()) {
    const detalles = errores.array().map(({ path, msg }) => ({ campo: path, mensaje: msg }))
    const conflicto = detalles.some(({ mensaje }) =>
      [mensajeCalificacionDuplicada, mensajeMateriaDuplicada].includes(mensaje)
    )

    return res.status(conflicto ? 409 : 400).json({
      error: conflicto ? 'Conflicto con un recurso existente' : 'Solicitud inválida',
      detalles,
    })
  }

  next()
}

const serializarCalificacion = (fila) => ({
  id: fila.id,
  alumno: fila.alumno,
  materia: { id: fila.materia_id, nombre: fila.materia },
  notas: [Number(fila.nota1), Number(fila.nota2), Number(fila.nota3)],
})

app.get('/materias', sinParametrosQuery, manejarErrores, async (req, res) => {
  const [materias] = await db.execute('SELECT id, nombre FROM materias ORDER BY id')
  res.json(materias)
})

app.get('/materias/:id', validarId, sinParametrosQuery, manejarErrores, async (req, res) => {
  const [materias] = await db.execute(
    'SELECT id, nombre FROM materias WHERE id = ?',
    [req.params.id]
  )

  if (materias.length === 0) {
    return res.status(404).json({ error: 'Materia no encontrada' })
  }

  res.json(materias[0])
})

app.post('/materias', sinParametrosQuery, validarMateria, manejarErrores, async (req, res) => {
  const { nombre } = req.body

  try {
    const [resultado] = await db.execute(
      'INSERT INTO materias (nombre) VALUES (?)',
      [nombre]
    )

    return res.location(`/materias/${resultado.insertId}`).status(201).json({
      id: resultado.insertId,
      nombre,
    })
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: mensajeMateriaDuplicada })
    }

    throw error
  }
})

app.put('/materias/:id', validarId, sinParametrosQuery, validarMateria, manejarErrores, async (req, res) => {
  try {
    const [resultado] = await db.execute(
      'UPDATE materias SET nombre = ? WHERE id = ?',
      [req.body.nombre, req.params.id]
    )

    if (resultado.affectedRows === 0) {
      const [existentes] = await db.execute(
        'SELECT id FROM materias WHERE id = ?',
        [req.params.id]
      )

      if (existentes.length === 0) {
        return res.status(404).json({ error: 'Materia no encontrada' })
      }
    }

    res.json({ id: Number(req.params.id), nombre: req.body.nombre })
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: mensajeMateriaDuplicada })
    }
    throw error
  }
})

app.delete('/materias/:id', validarId, sinParametrosQuery, manejarErrores, async (req, res) => {
  try {
    const [resultado] = await db.execute(
      'DELETE FROM materias WHERE id = ?',
      [req.params.id]
    )

    if (resultado.affectedRows === 0) {
      return res.status(404).json({ error: 'Materia no encontrada' })
    }

    res.status(204).end()
  } catch (error) {
    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(409).json({ error: mensajeMateriaEnUso })
    }

    throw error
  }
})

app.get('/calificaciones', validarConsultaCalificaciones, manejarErrores, async (req, res) => {
  let sql = `SELECT c.id, c.alumno, c.materia_id, m.nombre AS materia,
                     c.nota1, c.nota2, c.nota3
             FROM calificaciones c
             JOIN materias m ON m.id = c.materia_id`
  const condiciones = []
  const parametros = []

  if (req.query.alumno) {
    condiciones.push('c.alumno = ?')
    parametros.push(req.query.alumno)
  }

  if (req.query.materiaId) {
    condiciones.push('c.materia_id = ?')
    parametros.push(req.query.materiaId)
  }

  if (condiciones.length > 0) {
    sql += ` WHERE ${condiciones.join(' AND ')}`
  }

  sql += ' ORDER BY c.id'

  const [filas] = await db.execute(sql, parametros)
  res.json(filas.map(serializarCalificacion))
})

app.get('/calificaciones/:id', validarId, sinParametrosQuery, manejarErrores, async (req, res) => {
  const [filas] = await db.execute(
    `SELECT c.id, c.alumno, c.materia_id, m.nombre AS materia,
            c.nota1, c.nota2, c.nota3
     FROM calificaciones c
     JOIN materias m ON m.id = c.materia_id
     WHERE c.id = ?`,
    [req.params.id]
  )

  if (filas.length === 0) {
    return res.status(404).json({ error: 'Calificación no encontrada' })
  }

  res.json(serializarCalificacion(filas[0]))
})

app.post('/calificaciones', sinParametrosQuery, validarCalificacion(), manejarErrores, async (req, res) => {
  const { alumno, materiaId, notas } = req.body

  try {
    const [resultado] = await db.execute(
      'INSERT INTO calificaciones (alumno, materia_id, nota1, nota2, nota3) VALUES (?, ?, ?, ?, ?)',
      [alumno, materiaId, ...notas]
    )

    const [filas] = await db.execute(
      `SELECT c.id, c.alumno, c.materia_id, m.nombre AS materia,
              c.nota1, c.nota2, c.nota3
       FROM calificaciones c
       JOIN materias m ON m.id = c.materia_id
       WHERE c.id = ?`,
      [resultado.insertId]
    )

    return res.location(`/calificaciones/${resultado.insertId}`).status(201).json(serializarCalificacion(filas[0]))
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: mensajeCalificacionDuplicada })
    }

    throw error
  }
})

app.put('/calificaciones/:id', validarId, sinParametrosQuery, validarCalificacion(true), manejarErrores, async (req, res) => {
  const { alumno, materiaId, notas } = req.body

  try {
    const [resultado] = await db.execute(
      `UPDATE calificaciones
       SET alumno = ?, materia_id = ?, nota1 = ?, nota2 = ?, nota3 = ?
       WHERE id = ?`,
      [alumno, materiaId, ...notas, req.params.id]
    )

    if (resultado.affectedRows === 0) {
      const [existentes] = await db.execute(
        'SELECT id FROM calificaciones WHERE id = ?',
        [req.params.id]
      )

      if (existentes.length === 0) {
        return res.status(404).json({ error: 'Calificación no encontrada' })
      }
    }

    const [filas] = await db.execute(
      `SELECT c.id, c.alumno, c.materia_id, m.nombre AS materia,
              c.nota1, c.nota2, c.nota3
       FROM calificaciones c
       JOIN materias m ON m.id = c.materia_id
       WHERE c.id = ?`,
      [req.params.id]
    )

    res.json(serializarCalificacion(filas[0]))
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: mensajeCalificacionDuplicada })
    }

    throw error
  }
})

app.delete('/calificaciones/:id', validarId, sinParametrosQuery, manejarErrores, async (req, res) => {
  const [resultado] = await db.execute(
    'DELETE FROM calificaciones WHERE id = ?',
    [req.params.id]
  )

  if (resultado.affectedRows === 0) {
    return res.status(404).json({ error: 'Calificación no encontrada' })
  }

  res.status(204).end()
})

app.use((error, req, res, next) => {
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'El cuerpo debe contener JSON válido' })
  }

  console.error('Error no controlado:', error)
  res.status(500).json({ error: 'Error interno del servidor' })
})

const arrancarServidor = async () => {
  await crearConexion()
  await db.query('SELECT 1')

  app.listen(3000, () => {
    console.log('API lista en el puerto 3000')
  })
}

arrancarServidor().catch((error) => {
  console.error('La API no pudo iniciar correctamente:', error)
  process.exitCode = 1
})
