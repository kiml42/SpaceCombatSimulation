using Assets.Src.Interfaces;
using Assets.Src.ModuleSystem;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Evolution
{
    public class GenomeWrapper : IKnowsEnemyTags
    {
        private int _geneLength;
        private string _genome;
        private const int DEFAULT_NAME_LENGTH = 50;
        private const int DEFAULT_GENE_LENGTH = 3;

        public int NameLength { get; set; }

        public string Genome { get
            {
                return _genome;
            }
        }
        public float Cost { get; private set; }
        public float? Budget { get; set; }
        private int _position;
        private Stack<int> _previousPositions = new Stack<int>();

        public Dictionary<ModuleType, int> ModuleTypeCounts { get; private set; }
        public int ModulesAdded { get; private set; }

        public List<Vector3> UsedLocations { get; private set; }

        public bool UseJump = true;

        #region EnemyTags
        public void AddEnemyTag(string newTag)
        {
            var tags = EnemyTags.ToList();
            tags.Add(newTag);
            EnemyTags = tags.Distinct().ToList();
        }

        public List<string> EnemyTags { get; set; }
        #endregion

        public GenomeWrapper(string genome, List<string> enemyTags, int geneLength = DEFAULT_GENE_LENGTH)
        {
            _genome = genome;
            _geneLength = geneLength;
            NameLength = DEFAULT_NAME_LENGTH;
            Budget = null; //default tyhe budget to null, can be set later.
            UsedLocations = new List<Vector3>();
            EnemyTags = enemyTags;
            ModuleTypeCounts = new Dictionary<ModuleType, int>();
        }


        /// <summary>
        /// Register that a module (of any type) has been added
        /// </summary>
        /// <param name="types">List of types that this module should be treated as.</param>
        /// <returns>boolean indicating if any more can be added</returns>
        public bool ModuleAdded(ModuleTypeKnower knower, Vector3 usedLocation)
        {
            //TODO expand to all types.
            foreach (var type in knower.Types.Distinct())
            {
                if (ModuleTypeCounts.ContainsKey(type))
                {
                    ModuleTypeCounts[type]++;
                } else
                {
                    ModuleTypeCounts[type] = 1;
                }
            }
            ModulesAdded++;

            Cost += knower.Cost;

            UsedLocations.Add(usedLocation);

            return CanSpawn();
        }

        public string GetName()
        {
            return _genome.Substring(0, NameLength);
        }

        public bool CanSpawn()
        {
            var isUnderBudget = IsUnderBudget();
            var canSpawn =
                isUnderBudget;
                
            return canSpawn;
        }
        
        public bool IsUnderBudget()
        {
            return !Budget.HasValue || Cost < Budget.Value;
        }

        /// <summary>
        /// Returns the next gene
        /// </summary>
        /// <returns></returns>
        public string GetGene()
        {
            var gene = new StringBuilder();

            for (int i = 0; i < _geneLength; i++)
            {
                var character =  _genome[_position];
                _position = (_position+1) % _genome.Length;
                gene.Append(character);
            }
            
            return gene.ToString();
        }

        /// <summary>
        /// Reads the next gene, then jumps to the indicated position in the genome.
        /// if the gene does not have a valid integer value,
        /// the position will be left as the position after the gene was read for where to jump to.
        /// In this case, jump back will still return to this gene.
        /// </summary>
        public void Jump()
        {
            if (UseJump) {
                var gene = GetGeneAsInt();
                _previousPositions.Push(_position);
                if (gene.HasValue)
                {
                    _position = gene.Value;
                }
            }
        }

        /// <summary>
        /// Returns to the location before the last jump (will be one gene further on for the gene read by the jump)
        /// </summary>
        public void JumpBack()
        {
            if (UseJump)
            {
                if (_previousPositions.Any())
                {
                    _position = _previousPositions.Pop();
                }
                else
                {
                    Debug.LogWarning("Tried to jump back without having jumped.");
                }
            }
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
        /// Returns the next gene as a float between 0 and 1.
        /// </summary>
        /// <param name="defaultProporion"></param>
        /// <param name="length"></param>
        /// <returns></returns>
        public float GetProportionalNumber(float defaultProporion = 0.5f)
        {

            var substring = GetGene();

            var simplified = substring.TrimStart().Replace(" ", "");
            //Debug.Log(simplified);
            int number;
            if (int.TryParse(simplified, out number))
            {
                if ((Math.Pow(10, _geneLength) - 1) != 0)
                {
                    return (float)(number / (Math.Pow(10, _geneLength) - 1));
                }
                else
                {
                    Debug.LogWarning("Avoided div 0");
                } 
            }

            //Debug.Log("Defaulted to 0.5");
            return defaultProporion;
        }

        public float GetScaledNumber(float max, float min = 0, float defaultProportion = 0.5f)
        {
            var range = max - min;
            var randomValue = GetProportionalNumber(defaultProportion) * range;
            return min + randomValue;
        }

        public Color? ColorOverride = null;

        /// <summary>
        /// Returns the color object that this genome specifies
        /// </summary>
        /// <returns></returns>
        public Color GetColorForGenome()
        {
            if (ColorOverride.HasValue)
            {
                return ColorOverride.Value;
            }
            var r = GetNumberFromGenome(0, 0.5f, 8);
            var g = GetNumberFromGenome(10, 0.5f, 8);
            var b = GetNumberFromGenome(20, 0.5f, 8);

            return new Color(r, g, b);
        }

        /// <summary>
        /// Returns a float from the genome with the given parameters
        /// without moving the position in the genome for subsequent reads.
        /// </summary>
        /// <param name="fromEnd"></param>
        /// <param name="defaultProporion"></param>
        /// <param name="length"></param>
        /// <returns></returns>
        private float GetNumberFromGenome(int fromEnd, float defaultProporion = 0.5f, int length = 2)
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
                    if ((Math.Pow(10, length) - 1) != 0)
                        return (float)(number / (Math.Pow(10, length) - 1));
                    else
                        Debug.LogWarning("Avoided div0 error");
                }
            }
            //Debug.Log("Defaulted to 0.5");
            return defaultProporion;
        }

        private static string Reverse(string s)
        {
            char[] charArray = s.ToCharArray();
            Array.Reverse(charArray);
            return new string(charArray);
        }
    }
}
