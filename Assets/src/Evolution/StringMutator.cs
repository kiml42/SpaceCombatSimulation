using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Assets.src.Evolution
{
    public class StringMutator
    {
        public int GenomeLength = 50;
        public int Mutations = 3;
        public int MaxMutationLength = 3;
        public string AllowedCharacters = " 0123456789  ";

        #region Mutation
        public string Mutate(string baseGenome)
        {
            baseGenome = baseGenome.PadRight(GenomeLength, ' ');
            for (int i = 0; i < Mutations; i++)
            {
                var n = UnityEngine.Random.value;
                if (n < 0.5)
                {
                    //no mutation
                }
                else if (n < 0.6)
                {
                    //insert
                    baseGenome = InsertionMutation(baseGenome);
                }
                else if (n < 0.8)
                {
                    //Replace one character
                    baseGenome = CharReplaceMutation(baseGenome);
                }
                else if (n < 0.93)
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
        #endregion
    }
}
