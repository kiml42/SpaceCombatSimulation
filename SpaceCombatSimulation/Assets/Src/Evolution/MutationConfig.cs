using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Assets.Src.Evolution
{
    public class MutationConfig
    {
        public int Id;

        public int Mutations = 20;

        public int MaxMutationLength = 10;

        public int GenomeLength = 1000;

        public int GenerationSize = 20;

        public bool UseCompletelyRandomDefaultGenome = false;

        public string DefaultGenome = "";
    }
}
