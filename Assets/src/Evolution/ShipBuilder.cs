using Assets.Src.Evolution;
using Assets.Src.Interfaces;
using Assets.Src.ModuleSystem;
using Assets.Src.ObjectManagement;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.src.Evolution
{
    public class ShipBuilder
    {
        public int[] AllowedModuleIndicies = null;

        public Vector3 InitialVelocity = Vector3.zero;
        
        private GenomeWrapper _genome;
        public int GeneLength = 1;

        private ModuleList _moduleList;
        
        private ModuleHub _hubToBuildOn;
        private TestCubeChecker _testCubePrefab;
        
        private Color _colour;
        
        public ShipBuilder(GenomeWrapper genomeWrapper, ModuleHub hubToBuildOn)
        {
            _hubToBuildOn = hubToBuildOn;
            if (_hubToBuildOn == null)
            {
                throw new ArgumentNullException("shipToBuildOn", "shipToBuildOn must be a valid Transform.");
            }
            _moduleList = _hubToBuildOn.ModuleList;
            if(_moduleList == null)
            {
                throw new ArgumentNullException("moduleList", "moduleList must be a valid ModuleList objet.");
            }
            _genome = genomeWrapper;
            _testCubePrefab = _hubToBuildOn.TestCube;
        }

        public GenomeWrapper BuildShip(bool setColour = true)
        {
            //Debug.Log("Building " + _genome);
            if (setColour)
            {
                _colour = _genome.GetColorForGenome();
                _hubToBuildOn.transform.SetColor(_colour);
            }

            //Debug.Log("Spawning modules on " + _hubToBuildOn.name);

            _genome.UsedLocations.Add(_hubToBuildOn.transform.position);
            _genome = SpawnModules();
            
            return _genome;
        }

        [Obsolete("This shouldn't be setable")]
        public void SetGenome(GenomeWrapper genomeWrapper)
        {
            _genome = genomeWrapper;
        }

        private GenomeWrapper SpawnModules()
        {
            var spawnPoints = _hubToBuildOn.SpawnPoints;

            foreach (var spawnPoint in spawnPoints)
            {
                var newUsedLocation = Vector3.zero;
                if (CanSpawnHere(spawnPoint, out newUsedLocation))
                {
                    var moduleToAdd = SelectModule();

                    if (moduleToAdd != null)
                    {
                        if(_genome.IsUnderBudget())
                        {
                            //Debug.Log("adding " + moduleToAdd + " total cost = " + _genome.Cost);
                            var addedModule = GameObject.Instantiate(moduleToAdd, spawnPoint.position, spawnPoint.rotation, _hubToBuildOn.transform);
                            
                            addedModule.GetComponent<FixedJoint>().connectedBody = _hubToBuildOn.GetComponent<Rigidbody>();

                            var tagKnower = addedModule.GetComponent<IKnowsEnemyTags>();
                            if (tagKnower != null)
                            {
                                tagKnower.EnemyTags = _genome.EnemyTags;
                            }

                            var hub = addedModule.GetComponent<ModuleHub>();
                            if(hub != null)
                            {
                                hub.AllowedModuleIndicies = AllowedModuleIndicies;
                            }

                            addedModule.tag = _hubToBuildOn.tag;

                            addedModule.transform.SetColor(_colour);
                            addedModule.GetComponent<Rigidbody>().velocity = InitialVelocity;

                            addedModule.transform.SetColor(_colour);

                            _genome.Jump();
                            _genome = addedModule.Configure(_genome);
                            _genome.JumpBack();
                           
                            _genome.ModuleAdded(addedModule, newUsedLocation);
                        }
                        //else
                        //{
                        //    Debug.Log("Over budget: cost = " + _genome.Cost + ", budget = " + _genome.Budget);
                        //}
                    }
                    //else
                    //{
                    //    Debug.Log("skipping null module");
                    //}
                }
                //else
                //{
                //    Debug.Log("Can not spawn module here.");
                //}
            }
            return _genome;
        }

        /// <summary>
        /// The distance below which two test cubes colliders are considered too close to spawn.
        /// </summary>
        private const float THRESHOLD_DISTANCE = 1;

        private bool CanSpawnHere(Transform spawnPoint, out Vector3 newUsedLocation)
        {
            if (_testCubePrefab != null)
            {
                //Debug.Log("Creating Test Cube");
                var testCube = GameObject.Instantiate(_testCubePrefab, spawnPoint.position, spawnPoint.rotation);
                var collider = testCube.GetComponent<BoxCollider>();
                var center = collider.center;
                newUsedLocation = testCube.transform.TransformPoint(center); //turn it into world coords.
                //collider.bounds.Intersects();//could be useful if the center isn't enough.
                GameObject.Destroy(testCube.gameObject);
                if (IsUsedLocation(newUsedLocation))
                {
                    Debug.Log("Can't spawn at " + center + " because there is already something here");
                    return false;
                }
            }
            else
            {
                newUsedLocation = Vector3.zero; //set to zero if there isn't a test cube - it doesn't matter.
            }
            var canSpawn = _genome.CanSpawn();
            if (!canSpawn)
            {
                Debug.Log("Can't spawn module because the Genome says so.");
            }
            return canSpawn;
        }

        private bool IsUsedLocation(Vector3 worldLocation)
        {
            var distances = _genome.UsedLocations.Select(l => Vector3.Distance(l, worldLocation));
            return distances.Any(d => d < THRESHOLD_DISTANCE);
        }

        private ModuleTypeKnower SelectModule()
        {
            if (_genome.CanSpawn())
            {
                int? number = _genome.GetGeneAsInt();
                if (number.HasValue)
                {
                    var numberInRange = number.Value % _moduleList.Modules.Count();
                    if (AllowedModuleIndicies == null || !AllowedModuleIndicies.Any() || AllowedModuleIndicies.Contains(numberInRange))
                    {
                        //Debug.Log("Adding Module " + number + ": " + Modules[number.Value % _moduleList.Modules.Count()] );
                        return _moduleList.Modules[numberInRange];
                    }
                    else
                    {
                        Debug.Log("Not allowed to spawn module " + numberInRange);
                    }
                }
                //else
                //{
                //    Debug.Log("Failed to parse " + simplified + "as a number");
                //}
            }
            //else
            //{
            //    Debug.Log("Cannot read gene of length " + GeneLength + " at position " + _genomePosition + " in '" + _genome + "'");
            //}
            return null;
        }
    }
}

