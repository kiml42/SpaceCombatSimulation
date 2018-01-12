using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Evolution
{
    public class GenomeWrapper
    {
        private int _geneLength;
        private string _genome;
        public string Genome { get
            {
                return _genome;
            }
        }
        public float Cost { get; set; }
        public float Budget { get; set; }
        public int Position { get; private set; }

        public int TurretsAdded { get; set; }
        public int ModulesAdded { get; set; }
        public int MaxTurrets { get; set; }
        public int MaxModules { get; set; }

        public GenomeWrapper(string genome, int geneLength = 1)
        {
            _genome = genome;
            _geneLength = geneLength;
        }

        /// <summary>
        /// Register that a turret has been added
        /// </summary>
        /// <returns>boolean indicating if any more can be added</returns>
        public bool TurretAdded()
        {
            TurretsAdded++;
            //a turret is always a module s add to that too.
            return TurretsAdded < MaxTurrets && ModuleAdded();
        }

        /// <summary>
        /// Register that a module (of any type) has been added
        /// </summary>
        /// <returns>boolean indicating if any more can be added</returns>
        public bool ModuleAdded()
        {
            ModulesAdded++;
            return ModulesAdded < MaxModules;
        }

        internal string GetName()
        {
            throw new NotImplementedException();
        }

        public bool CanSpawn()
        {
            var canSpawn = 
                Position + _geneLength < _genome.Length && 
                Cost < Budget &&
                TurretsAdded < MaxTurrets && 
                ModulesAdded < MaxModules;
            return canSpawn;
        }

        /// <summary>
        /// Returns the next gene
        /// </summary>
        /// <returns></returns>
        public string GetGene()
        {
            var substring = _genome.Substring(Position, _geneLength);
            Position += _geneLength;
            return substring;
        }

        /// <summary>
        /// Geturns the next gene as an int - null if it is empty or can't be parsed
        /// </summary>
        /// <returns></returns>
        public int? GetGeneAsInt()
        {
            var substring = GetGene();
            //Debug.Log("Gene to spawn: " + substring);

            var simplified = substring.Replace(" ", "");

            int number;
            if (int.TryParse(simplified, out number))
            {
                return number;
            }
            return null;
        }

        /// <summary>
        /// Returns a float from the genome with the given parameters
        /// without moving the position in the genome for subsequent reads.
        /// </summary>
        /// <param name="fromEnd"></param>
        /// <param name="defaultProporion"></param>
        /// <param name="length"></param>
        /// <returns></returns>
        public float GetNumberFromGenome(int fromEnd, float defaultProporion = 0.5f, int length = 2)
        {
            var reversed = Reverse(_genome);
            if (fromEnd + length < reversed.Length)
            {
                var substring = reversed.Substring(fromEnd, length);

                var simplified = substring.TrimStart().Replace(" ", "0");
                //Debug.Log(simplified);
                int number;
                if (int.TryParse(simplified, out number))
                {
                    return (float)(number / (Math.Pow(10, length) - 1));
                }
            }
            //Debug.Log("Defaulted to 0.5");
            return defaultProporion;
        }

        /// <summary>
        /// Returns the color object that this genome specifies
        /// </summary>
        /// <returns></returns>
        public Color GetColorForGenome()
        {
            var r = GetNumberFromGenome(0, 0.5f, 8);
            var g = GetNumberFromGenome(10, 0.5f, 8);
            var b = GetNumberFromGenome(20, 0.5f, 8);

            return new Color(r, g, b);
        }
        
        private static string Reverse(string s)
        {
            char[] charArray = s.ToCharArray();
            Array.Reverse(charArray);
            return new string(charArray);
        }
    }
}
