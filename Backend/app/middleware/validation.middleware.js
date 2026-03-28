import Joi from 'joi';

/**
 * Factory middleware to validate request body against a Joi schema.
 * Usage: router.post('/', validateBody(schema), handler);
 */
export const validateBody = (schema) => (req, res, next) => {
    const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
        return res.status(400).json({
            status: 'FAILED',
            reason: 'Validation error',
            details: error.details.map(d => d.message)
        });
    }
    req.body = value;
    next();
};
