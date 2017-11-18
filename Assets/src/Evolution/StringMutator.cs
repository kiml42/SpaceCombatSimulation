using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.src.Evolution
{
    public class StringMutator
    {
        public int GenomeLength = 50;
        public int Mutations = 3;
        public int MaxMutationLength = 3;
        public string AllowedCharacters = " 0123456789  ";

        /// <summary>
        /// Creates a whole generation of mutated genomes.
        /// </summary>
        /// <param name="baseGenomes">genomes to mutate. Use null to generate random</param>
        /// <param name="generationSize">number of genomes to return</param>
        /// <returns></returns>
        public List<string> CreateGenerationOfMutants(List<string> baseGenomes, int generationSize)
        {
            //Debug.Log("Generating generation from [" + string.Join(",", baseGenomes.ToArray()) + "]");
            var generation = new List<string>();
            int i = 0;
            //Debug.Log("IndinvidualsCount = " + genration.CountIndividuals());
            while (generation.Count() < generationSize)
            {
                string baseGenome;
                string mutant;
                if (baseGenomes != null && baseGenomes.Any())
                {
                    baseGenome = baseGenomes[i];
                    mutant = Mutate(baseGenome);
                    i++;
                    i = i % baseGenomes.Count;
                }
                else
                {
                    baseGenome = "Primordial Ooze";
                    mutant = GenerateCompletelyRandomGenome();
                }
                if (IsValidGenome(mutant))
                {
                    Debug.Log(mutant + " spawn of " + baseGenome + " is born");
                    generation.Add(mutant);
                    generation = generation.Distinct().ToList();
                    //Debug.Log("IndinvidualsCount = " + genration.CountIndividuals());
                }
                else
                {
                    Debug.Log(mutant + " spawn of " + baseGenome + " is too rubbish to be born");
                }
            }
            //Debug.Log("mutant Generation: " + genration);
            return generation;
        }

        public string Mutate(string baseGenome)
        {
            baseGenome = baseGenome.PadRight(GenomeLength, ' ');
            for (int i = 0; i < Mutations; i++)
            {
                var n = UnityEngine.Random.value;
                if (n < 0.2)
                {
                    //no mutation
                }
                else if (n < 0.3)
                {
                    //insert
                    baseGenome = InsertionMutation(baseGenome);
                }
                else if (n < 0.6)
                {
                    //Replace one character
                    baseGenome = CharReplaceMutation(baseGenome);
                }
                else if (n < 0.7)
                {
                    //delete
                    baseGenome = DeletionMutation(baseGenome);
                }
                else
                {
                    //duplicate
                    baseGenome = ReverseMutation(baseGenome);
                }
            }

            if (baseGenome.Length > GenomeLength)
            {
                return baseGenome.Substring(0, GenomeLength);
            }
            return baseGenome;
        }

        public string GenerateCompletelyRandomGenome()
        {
            string genome = "";
            while(genome.Length < GenomeLength)
            {
                genome = InsertionMutation(genome);
            }
            return genome.Substring(0, GenomeLength);
        }

        private string InsertionMutation(string genome)
        {
            int n = (int)(UnityEngine.Random.value * AllowedCharacters.Length);
            var character = AllowedCharacters[n];
            int m = (int)(UnityEngine.Random.value * genome.Length);
            return genome.Insert(m, character.ToString());
        }

        private string CharReplaceMutation(string genome)
        {
            int n = (int)(UnityEngine.Random.value * AllowedCharacters.Length);
            var character = AllowedCharacters[n];
            int m = (int)(UnityEngine.Random.value * genome.Length);
            genome = genome.Remove(m, 1);
            return genome.Insert(m, character.ToString());
        }

        private string DeletionMutation(string genome)
        {
            int n = (int)(UnityEngine.Random.value * genome.Length);
            int count = PickALength(n, genome.Length);
            //Debug.Log("n:" + n + ", count:" + count + ", length:" + genome.Length);
            genome = genome.Remove(n, count);
            genome = genome.PadRight(GenomeLength, ' ');
            return genome;
        }

        private string ReverseMutation(string genome)
        {
            int n = (int)(UnityEngine.Random.value * genome.Length);
            int count = PickALength(n, genome.Length);
            var sectionToReverse = Reverse(genome.Substring(n, count));
            genome = genome.Remove(n, count);
            return genome.Insert(n, sectionToReverse);
        }
        
        private bool IsValidGenome(string baseGenome)
        {
            //replace 2 so engines don't make a valid ship.
            var start = baseGenome.Replace("2", " ").Substring(0, 6).Trim();
            //Debug.Log("'" + start + "'");
            var valid = !string.IsNullOrEmpty(start);
            //Debug.Log("'" + baseGenome + "' valid? " + valid);
            return valid;
        }

        public static string Reverse(string s)
        {
            char[] charArray = s.ToCharArray();
            Array.Reverse(charArray);
            return new string(charArray);
        }

        private int PickALength(int start, int fullLength)
        {
            var remaining = fullLength - start;
            if (remaining == 0)
            {
                return remaining;
            }
            var limit = Math.Min(remaining, MaxMutationLength);
            var result = (int)UnityEngine.Random.value * limit;
            return Math.Max(result, 1);
        }
    }
}
