using System;
using System.Collections.Generic;
using UnityEngine;

namespace Assets.Src.Evolution
{
    public class EvolutionMutationWrapper
    {
        private MutationConfig _config = new MutationConfig();
        private readonly StringMutator _mutator;
        public float NewStartersProportion = 0;

        public MutationConfig Config
        {
            get
            {
                return _config;
            }
            set
            {
                _config = value;
                _mutator.Config = value;
            }
        }

        public EvolutionMutationWrapper()
        {
            _mutator = new StringMutator(Config);
        }

        /// <summary>
        /// Generates a new generation of mutated individuals
        /// </summary>
        /// <param name="baseGenomes">The genomes to base the mustants off</param>
        /// <param name="persistentGenomes">Genomes to include unaltered</param>
        /// <returns></returns>
        public List<string> CreateGenerationOfMutants(List<string> baseGenomes, List<string> persistentGenomes = null)
        {
            persistentGenomes = persistentGenomes ?? new List<string>();
            var numberOfNewIndividuals = (int)Math.Ceiling(Config.GenerationSize * NewStartersProportion);

            var mutants = _mutator.CreateGenerationOfMutants(baseGenomes, Config.GenerationSize - numberOfNewIndividuals - persistentGenomes.Count);
            var newIndividuals = CreateNewIndividuals(numberOfNewIndividuals);

            Debug.Log($"Creating new generation. New individuals: {numberOfNewIndividuals} , Derrived individuals:  {mutants.Count}, PersistentGenomes: {persistentGenomes.Count}");

            mutants.AddRange(newIndividuals);

            mutants.AddRange(persistentGenomes);

            if(mutants.Count != Config.GenerationSize)
            {
                Debug.LogWarning($"Generation hhas {mutants.Count}, expected {Config.GenerationSize}");
            }

            return mutants;
        }

        public List<string> CreateDefaultGeneration()
        {
            return CreateNewIndividuals(Config.GenerationSize);
        }

        private List<string> CreateNewIndividuals(int numberOfNewIndividuals)
        {
            var baseGenomes = Config.UseCompletelyRandomDefaultGenome ? null : new List<string> { PadGenome(Config.DefaultGenome) };
            return _mutator.CreateGenerationOfMutants(baseGenomes, numberOfNewIndividuals);
        }

        private string PadGenome(string genome)
        {
            if (string.IsNullOrEmpty(genome))
            {
                return string.Empty.PadRight(_config.GenomeLength);
            }

            while (genome.Length < _config.GenomeLength)
            {
                genome = genome + genome;
            }
            return genome.Substring(0, _config.GenomeLength);
        }

        public string CreateSingleMutant(string original)
        {
            return _mutator.Mutate(original);
        }
    }

}