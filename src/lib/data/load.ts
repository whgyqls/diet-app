// Validated food and seasoning data for screens.
import foodsJson from '../../../data/foods.json';
import seasoningsJson from '../../../data/seasonings.json';
import { foodsFileSchema, seasoningsFileSchema } from './schemas';

export const FOODS = foodsFileSchema.parse(foodsJson).foods;
export const SEASONINGS = seasoningsFileSchema.parse(seasoningsJson).seasonings;
