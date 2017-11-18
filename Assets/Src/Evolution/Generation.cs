using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Assets.Src.Evolution
{
    public interface IGeneration
    {
        int CountIndividuals();

        /// <summary>
        /// Adds a new individual with the given genome.
        /// Does nothing in the case of a duplicate
        /// </summary>
        /// <param name="genome"></param>
        /// <returns>Successfully added - false id genome already present.</returns>
        bool AddGenome(string genome);

        /// <summary>
        /// Adds the given genomes to the generation
        /// </summary>
        /// <param name="Genomes"></param>
        /// <returns>Count of individuals</returns>
        int AddGenomes(List<string> Genomes);

        /// <summary>
        /// The lowest number of matches played by any individual
        /// </summary>
        /// <returns></returns>
        int MinimumMatchesPlayed();

        /// <summary>
        /// Picks the given number of individuals with the best scores.
        /// </summary>
        /// <param name="WinnersCount"></param>
        /// <returns>List of genomes</returns>
        IEnumerable<string> PickWinners(int WinnersCount);
    }
}
